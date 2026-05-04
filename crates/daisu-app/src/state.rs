//! Process-wide app state managed by Tauri's `manage()` API.
//!
//! `AppState` holds the active workspace's cancellation token (so a new
//! `open_workspace` can cancel a prior walker) and the current root path.
//! Phase 5 adds the dedicated git watcher handle and its cancellation token.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use daisu_agent::index::Indexer;
use daisu_agent::memory::MemoryStore;
use daisu_agent::runtime::CancelToken as AgentCancelToken;
use daisu_agent::tools::ProposeEdit;
use daisu_agent::{McpRegistry, PermissionGate, ToolRegistry};
use notify::RecommendedWatcher;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub struct AppState {
    pub workspace_root: Mutex<Option<PathBuf>>,
    pub walker_token: Mutex<Option<CancellationToken>>,
    git_cancel: parking_lot::Mutex<Option<CancellationToken>>,
    git_watcher: parking_lot::Mutex<Option<RecommendedWatcher>>,
    pub mcp_registry: Arc<McpRegistry>,
    indexers: parking_lot::Mutex<HashMap<PathBuf, Arc<Indexer>>>,
    /// Shared, stateless tool registry. Built once at startup.
    pub tool_registry: Arc<ToolRegistry>,
    /// Per-workspace permission gates, keyed by canonicalised path.
    /// Created lazily on first `agent_tool_dispatch` call. The cache is
    /// bounded by `MAX_GATES`; oldest entries evict in insertion order.
    pub permission_gates: parking_lot::Mutex<HashMap<PathBuf, Arc<PermissionGate>>>,
    agent_memory: parking_lot::Mutex<HashMap<PathBuf, Arc<MemoryStore>>>,
    agent_runs: parking_lot::Mutex<HashMap<String, AgentCancelToken>>,
    pending_edits: parking_lot::Mutex<HashMap<Uuid, ProposeEdit>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace_root: Mutex::new(None),
            walker_token: Mutex::new(None),
            git_cancel: parking_lot::Mutex::new(None),
            git_watcher: parking_lot::Mutex::new(None),
            mcp_registry: Arc::new(McpRegistry::new()),
            indexers: parking_lot::Mutex::new(HashMap::new()),
            tool_registry: Arc::new(ToolRegistry::default()),
            permission_gates: parking_lot::Mutex::new(HashMap::new()),
            agent_memory: parking_lot::Mutex::new(HashMap::new()),
            agent_runs: parking_lot::Mutex::new(HashMap::new()),
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

    /// Clone a pending edit proposal without removing it. Used by
    /// `agent_apply_edit` so the proposal stays in the map if the
    /// disk write fails — the user can retry without re-running the
    /// agent prompt.
    #[must_use]
    pub fn peek_pending_edit(&self, id: Uuid) -> Option<ProposeEdit> {
        self.pending_edits.lock().get(&id).cloned()
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

    /// Drop a cached permission gate. Called from `close_workspace` so
    /// per-workspace state doesn't accumulate forever in long sessions.
    pub fn drop_permission_gate(&self, workspace: &PathBuf) {
        self.permission_gates.lock().remove(workspace);
    }

    /// Insert a permission gate under a workspace key, evicting the
    /// oldest entry once the cache exceeds `MAX_GATES`. Bounded so users
    /// who jump between many projects don't grow the cache without
    /// limit.
    pub fn cache_permission_gate(&self, workspace: PathBuf, gate: Arc<PermissionGate>) {
        const MAX_GATES: usize = 16;
        let mut guard = self.permission_gates.lock();
        if guard.len() >= MAX_GATES {
            if let Some(stale) = guard.keys().next().cloned() {
                guard.remove(&stale);
            }
        }
        guard.insert(workspace, gate);
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

    /// Drop the cached agent memory store for a workspace. Call from
    /// `close_workspace` so `SQLite` handles release WAL files when the user
    /// switches projects. Idempotent.
    pub fn drop_agent_memory(&self, workspace: &PathBuf) {
        self.agent_memory.lock().remove(workspace);
    }

    /// Drop every cached agent store + cancel every active run. Used when
    /// the app shuts down or the workspace fully resets, so a long-running
    /// stream doesn't outlive the workspace it was bound to.
    pub fn reset_agent_state(&self) {
        for (_, token) in self.agent_runs.lock().drain() {
            token.cancel();
        }
        self.agent_memory.lock().clear();
    }
}
