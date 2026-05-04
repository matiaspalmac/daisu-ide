//! Process-wide app state managed by Tauri's `manage()` API.
//!
//! `AppState` holds the active workspace's cancellation token (so a new
//! `open_workspace` can cancel a prior walker) and the current root path.
//! Phase 5 adds the dedicated git watcher handle and its cancellation token.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use daisu_agent::memory::MemoryStore;
use daisu_agent::runtime::CancelToken as AgentCancelToken;
use notify::RecommendedWatcher;
use tokio_util::sync::CancellationToken;

pub struct AppState {
    pub workspace_root: Mutex<Option<PathBuf>>,
    pub walker_token: Mutex<Option<CancellationToken>>,
    git_cancel: parking_lot::Mutex<Option<CancellationToken>>,
    git_watcher: parking_lot::Mutex<Option<RecommendedWatcher>>,
    agent_memory: parking_lot::Mutex<HashMap<PathBuf, Arc<MemoryStore>>>,
    agent_runs: parking_lot::Mutex<HashMap<String, AgentCancelToken>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace_root: Mutex::new(None),
            walker_token: Mutex::new(None),
            git_cancel: parking_lot::Mutex::new(None),
            git_watcher: parking_lot::Mutex::new(None),
            agent_memory: parking_lot::Mutex::new(HashMap::new()),
            agent_runs: parking_lot::Mutex::new(HashMap::new()),
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

    /// Open or reuse the per-workspace agent memory store.
    ///
    /// # Errors
    ///
    /// Returns the formatted error if `SQLite` cannot open or migrate the
    /// `.daisu/agent.db` file under `workspace`.
    pub fn agent_memory(&self, workspace: &PathBuf) -> Result<Arc<MemoryStore>, String> {
        let mut guard = self.agent_memory.lock();
        if let Some(s) = guard.get(workspace) {
            return Ok(s.clone());
        }
        let path = workspace.join(".daisu").join("agent.db");
        let store = MemoryStore::open(&path).map_err(|e| format!("agent memory: {e}"))?;
        let arc = Arc::new(store);
        guard.insert(workspace.clone(), arc.clone());
        Ok(arc)
    }

    pub fn register_agent_run(&self, run_id: String, token: AgentCancelToken) {
        self.agent_runs.lock().insert(run_id, token);
    }

    pub fn cancel_agent_run(&self, run_id: &str) -> bool {
        if let Some(token) = self.agent_runs.lock().remove(run_id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    pub fn drop_agent_run(&self, run_id: &str) {
        self.agent_runs.lock().remove(run_id);
    }
}
