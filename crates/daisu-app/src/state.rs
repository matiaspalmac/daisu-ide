//! Process-wide app state managed by Tauri's `manage()` API.
//!
//! `AppState` holds the active workspace's cancellation token (so a new
//! `open_workspace` can cancel a prior walker) and the current root path.

use std::path::PathBuf;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct AppState {
    pub workspace_root: Mutex<Option<PathBuf>>,
    pub walker_token: Mutex<Option<CancellationToken>>,
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
}
