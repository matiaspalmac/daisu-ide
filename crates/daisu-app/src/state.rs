//! Process-wide app state managed by Tauri's `manage()` API.
//!
//! `AppState` holds the active workspace's cancellation token (so a new
//! `open_workspace` can cancel a prior walker) and the current root path.
//! Phase 5 adds the dedicated git watcher handle and its cancellation token.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use notify::RecommendedWatcher;
use tokio_util::sync::CancellationToken;

pub struct AppState {
    pub workspace_root: Mutex<Option<PathBuf>>,
    pub walker_token: Mutex<Option<CancellationToken>>,
    git_cancel: Arc<CancellationToken>,
    git_watcher: parking_lot::Mutex<Option<RecommendedWatcher>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace_root: Mutex::new(None),
            walker_token: Mutex::new(None),
            git_cancel: Arc::new(CancellationToken::new()),
            git_watcher: parking_lot::Mutex::new(None),
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

    /// Borrow the shared git cancellation token. Phase 5 git watcher checks
    /// this on every tick to know when the workspace is closing.
    #[must_use]
    pub fn git_cancel(&self) -> &CancellationToken {
        &self.git_cancel
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
}
