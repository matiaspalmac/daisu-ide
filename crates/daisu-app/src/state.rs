//! Process-wide app state managed by Tauri's `manage()` API.
//!
//! `AppState` holds the active workspace's cancellation token (so a new
//! `open_workspace` can cancel a prior walker) and the current root path.
//! Phase 5 adds the dedicated git watcher handle and its cancellation token.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use daisu_agent::index::Indexer;
use notify::RecommendedWatcher;
use tokio_util::sync::CancellationToken;

pub struct AppState {
    pub workspace_root: Mutex<Option<PathBuf>>,
    pub walker_token: Mutex<Option<CancellationToken>>,
    git_cancel: parking_lot::Mutex<Option<CancellationToken>>,
    git_watcher: parking_lot::Mutex<Option<RecommendedWatcher>>,
    indexers: parking_lot::Mutex<HashMap<PathBuf, Arc<Indexer>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace_root: Mutex::new(None),
            walker_token: Mutex::new(None),
            git_cancel: parking_lot::Mutex::new(None),
            git_watcher: parking_lot::Mutex::new(None),
            indexers: parking_lot::Mutex::new(HashMap::new()),
        }
    }
}

impl AppState {
    /// Atomically swap in a new walker token. Returns the previous token
    /// (caller should `.cancel()` it before dropping).
    ///
    /// # Panics
    ///
    /// Panics if the internal `walker_token` mutex is poisoned (i.e. another
    /// thread panicked while holding the lock).
    #[must_use]
    pub fn replace_walker_token(&self, new_token: CancellationToken) -> Option<CancellationToken> {
        let mut guard = self
            .walker_token
            .lock()
            .expect("walker_token mutex poisoned");
        guard.replace(new_token)
    }

    /// Take the current walker token, leaving `None` in its place.
    ///
    /// # Panics
    ///
    /// Panics if the internal `walker_token` mutex is poisoned.
    #[must_use]
    pub fn take_walker_token(&self) -> Option<CancellationToken> {
        self.walker_token
            .lock()
            .expect("walker_token mutex poisoned")
            .take()
    }

    /// Set (or clear) the active workspace root.
    ///
    /// # Panics
    ///
    /// Panics if the internal `workspace_root` mutex is poisoned.
    pub fn set_root(&self, root: Option<PathBuf>) {
        *self
            .workspace_root
            .lock()
            .expect("workspace_root mutex poisoned") = root;
    }

    /// Return a clone of the current workspace root, if any.
    ///
    /// # Panics
    ///
    /// Panics if the internal `workspace_root` mutex is poisoned.
    #[must_use]
    pub fn root(&self) -> Option<PathBuf> {
        self.workspace_root
            .lock()
            .expect("workspace_root mutex poisoned")
            .clone()
    }

    /// Replace the active git cancellation token. Cancels the previous token
    /// (if any) so the prior debounce loop exits cleanly. Returns the freshly
    /// installed token for the caller to hand to the watcher.
    pub fn replace_git_cancel(&self) -> CancellationToken {
        let mut guard = self.git_cancel.lock();
        if let Some(prev) = guard.take() {
            prev.cancel();
        }
        let token = CancellationToken::new();
        *guard = Some(token.clone());
        token
    }

    /// Cancel the active git cancellation token (stops the debounce loop) and
    /// clear it. Idempotent.
    pub fn cancel_git(&self) {
        let mut guard = self.git_cancel.lock();
        if let Some(prev) = guard.take() {
            prev.cancel();
        }
    }

    /// Store the active git watcher handle. Dropping the handle stops the
    /// underlying notify watcher.
    pub fn set_git_watcher(&self, watcher: RecommendedWatcher) {
        *self.git_watcher.lock() = Some(watcher);
    }

    /// Drop the active git watcher (stops it). Called from `close_workspace`.
    pub fn drop_git_watcher(&self) {
        *self.git_watcher.lock() = None;
    }

    /// Normalise a workspace path to its canonical, absolute form so
    /// every cache helper agrees on the lookup key. Falls back to the
    /// original buffer when canonicalisation fails (e.g. the directory
    /// has just been deleted) so the caller still gets a deterministic
    /// key instead of a panic.
    #[must_use]
    fn normalise_workspace(workspace: &Path) -> PathBuf {
        workspace
            .canonicalize()
            .unwrap_or_else(|_| workspace.to_path_buf())
    }

    /// Look up a cached symbol indexer for `workspace`. The lookup key
    /// is the canonicalised path so callers don't have to pre-normalise.
    #[must_use]
    pub fn indexer_for(&self, workspace: &Path) -> Option<Arc<Indexer>> {
        let key = Self::normalise_workspace(workspace);
        self.indexers.lock().get(&key).cloned()
    }

    /// Get the cached `Indexer` for `workspace`, or build one in-place
    /// under a single mutex acquisition so two concurrent callers can't
    /// each spin up their own instance and race the `SQLite` store open.
    ///
    /// # Errors
    ///
    /// Forwards whatever error string `init` returns — typically a
    /// `daisu-agent` `SQLite` open failure.
    pub fn indexer_get_or_init<F>(&self, workspace: &Path, init: F) -> Result<Arc<Indexer>, String>
    where
        F: FnOnce(&Path) -> Result<Indexer, String>,
    {
        let key = Self::normalise_workspace(workspace);
        let mut guard = self.indexers.lock();
        if let Some(existing) = guard.get(&key) {
            return Ok(existing.clone());
        }
        let indexer = Arc::new(init(&key)?);
        guard.insert(key, indexer.clone());
        Ok(indexer)
    }

    /// Drop a cached indexer (called when the workspace closes).
    pub fn drop_indexer(&self, workspace: &Path) {
        let key = Self::normalise_workspace(workspace);
        self.indexers.lock().remove(&key);
    }
}
