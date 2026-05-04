//! Process-wide app state managed by Tauri's `manage()` API.
//!
//! `AppState` holds the active workspace's cancellation token (so a new
//! `open_workspace` can cancel a prior walker) and the current root path.
//! Phase 5 adds the dedicated git watcher handle and its cancellation token.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use daisu_agent::tools::ProposeEdit;
use notify::RecommendedWatcher;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub struct AppState {
    pub workspace_root: Mutex<Option<PathBuf>>,
    pub walker_token: Mutex<Option<CancellationToken>>,
    git_cancel: parking_lot::Mutex<Option<CancellationToken>>,
    git_watcher: parking_lot::Mutex<Option<RecommendedWatcher>>,
    pending_edits: parking_lot::Mutex<HashMap<Uuid, ProposeEdit>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace_root: Mutex::new(None),
            walker_token: Mutex::new(None),
            git_cancel: parking_lot::Mutex::new(None),
            git_watcher: parking_lot::Mutex::new(None),
            pending_edits: parking_lot::Mutex::new(HashMap::new()),
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

    /// Register a freshly built edit proposal and return its id.
    pub fn register_pending_edit(&self, proposal: ProposeEdit) -> Uuid {
        let id = Uuid::new_v4();
        self.pending_edits.lock().insert(id, proposal);
        id
    }

    /// Remove and return a pending edit proposal by id.
    #[must_use]
    pub fn take_pending_edit(&self, id: Uuid) -> Option<ProposeEdit> {
        self.pending_edits.lock().remove(&id)
    }

    /// Snapshot of currently pending edits (id + path), for status UI.
    #[must_use]
    pub fn list_pending_edits(&self) -> Vec<(Uuid, PathBuf, usize)> {
        self.pending_edits
            .lock()
            .iter()
            .map(|(id, p)| (*id, p.path.clone(), p.hunks.len()))
            .collect()
    }
}
