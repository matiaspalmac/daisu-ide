//! Async permission gate.
//!
//! The gate owns:
//!   1. The persistent allowlist (SQLite `permissions` table).
//!   2. A pending-request map keyed by request id; each entry parks a
//!      [`oneshot::Sender`] that the host (Tauri command) completes from
//!      the UI's `agent_permission_resolve` callback.
//!   3. An [`EventEmitter`] trait so the agent crate stays Tauri-free —
//!      `daisu-app` plugs its own emitter that calls `AppHandle::emit`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use uuid::Uuid;

use super::{Decision, PermissionRequest};
use crate::error::{AgentError, AgentResult};
use crate::memory::MemoryStore;

/// Payload pushed to the frontend when a tool call needs approval.
///
/// The frontend renders a modal and replies with
/// `agent_permission_resolve(request_id, decision)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequestEvent {
    pub request_id: String,
    pub tool_name: String,
    pub scope: String,
    pub tier: super::PermissionTier,
    pub summary: String,
}

/// Abstraction over the Tauri `AppHandle::emit` call so the agent crate
/// stays decoupled from Tauri. `daisu-app` provides the concrete impl.
pub trait EventEmitter: Send + Sync {
    /// Emit the named event with a JSON payload.
    fn emit(&self, event: &str, payload: &PermissionRequestEvent) -> Result<(), String>;
}

/// No-op emitter for tests / non-Tauri callers. Always denies in
/// practice because the modal can never be shown.
pub struct NoopEmitter;

impl EventEmitter for NoopEmitter {
    fn emit(&self, _event: &str, _payload: &PermissionRequestEvent) -> Result<(), String> {
        Ok(())
    }
}

/// One row of the persistent allowlist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllowlistEntry {
    pub tool_name: String,
    pub scope_glob: String,
    pub decision: String,
    pub created_at: i64,
}

/// Tauri event name the gate emits when it needs UI approval.
pub const PERMISSION_REQUEST_EVENT: &str = "agent://permission-request";

pub struct PermissionGate {
    store: Arc<MemoryStore>,
    emitter: Arc<dyn EventEmitter>,
    pending: Mutex<HashMap<String, oneshot::Sender<Decision>>>,
}

impl PermissionGate {
    #[must_use]
    pub fn new(store: Arc<MemoryStore>, emitter: Arc<dyn EventEmitter>) -> Self {
        Self {
            store,
            emitter,
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// Look up a persisted decision for `tool_name` matching `scope`.
    /// `scope_glob` is matched literally for the scaffold; M3 Phase 4
    /// upgrades this to real glob matching.
    pub fn is_allowed(&self, tool_name: &str, scope: &str) -> AgentResult<Option<Decision>> {
        let conn = self.store.connection();
        let guard = conn
            .lock()
            .map_err(|_| AgentError::Internal("memory mutex poisoned".into()))?;
        let mut stmt = guard.prepare(
            "SELECT decision FROM permissions \
             WHERE tool_name = ?1 AND (scope_glob = ?2 OR scope_glob = '*') \
             ORDER BY created_at DESC LIMIT 1",
        )?;
        let mut rows = stmt.query(params![tool_name, scope])?;
        if let Some(row) = rows.next()? {
            let decision: String = row.get(0)?;
            return Ok(match decision.as_str() {
                "allow" => Some(Decision::AllowAlways),
                "deny" => Some(Decision::DenyAlways),
                _ => None,
            });
        }
        Ok(None)
    }

    /// Park the future on a oneshot, emit the UI event, and wait for
    /// `resolve` to be called with the user's choice. If the emitter
    /// fails (no listener), we synthesise a [`Decision::Deny`].
    pub async fn request_approval(&self, req: PermissionRequest) -> AgentResult<Decision> {
        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| AgentError::Internal("pending mutex poisoned".into()))?;
            pending.insert(request_id.clone(), tx);
        }

        let event = PermissionRequestEvent {
            request_id: request_id.clone(),
            tool_name: req.tool_name.clone(),
            scope: req.scope.clone(),
            tier: req.tier,
            summary: req.summary.clone(),
        };
        if let Err(err) = self.emitter.emit(PERMISSION_REQUEST_EVENT, &event) {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&request_id);
            }
            return Err(AgentError::Internal(format!(
                "emit permission event: {err}"
            )));
        }

        let decision = rx
            .await
            .map_err(|_| AgentError::Internal("permission channel dropped".into()))?;

        if decision.persists() {
            self.persist(&req.tool_name, &req.scope, decision)?;
        }
        Ok(decision)
    }

    /// Resolve a pending request from the host (Tauri command).
    /// Returns `false` if the id was unknown or already resolved.
    pub fn resolve(&self, request_id: &str, decision: Decision) -> bool {
        let Ok(mut pending) = self.pending.lock() else {
            return false;
        };
        match pending.remove(request_id) {
            Some(tx) => tx.send(decision).is_ok(),
            None => false,
        }
    }

    /// Write a decision to the `permissions` table. `Allow*` → `allow`,
    /// `Deny*` → `deny`. Conflicts on `(tool_name, scope_glob)` upsert.
    pub fn persist(
        &self,
        tool_name: &str,
        scope_glob: &str,
        decision: Decision,
    ) -> AgentResult<()> {
        let value = match decision {
            Decision::AllowOnce | Decision::AllowAlways => "allow",
            Decision::Deny | Decision::DenyAlways => "deny",
        };
        let now = Utc::now().timestamp();
        let conn = self.store.connection();
        let guard = conn
            .lock()
            .map_err(|_| AgentError::Internal("memory mutex poisoned".into()))?;
        guard.execute(
            "INSERT INTO permissions (tool_name, scope_glob, decision, created_at) \
             VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT (tool_name, scope_glob) DO UPDATE SET \
                 decision = excluded.decision, created_at = excluded.created_at",
            params![tool_name, scope_glob, value, now],
        )?;
        Ok(())
    }

    pub fn list_allowlist(&self) -> AgentResult<Vec<AllowlistEntry>> {
        let conn = self.store.connection();
        let guard = conn
            .lock()
            .map_err(|_| AgentError::Internal("memory mutex poisoned".into()))?;
        let mut stmt = guard.prepare(
            "SELECT tool_name, scope_glob, decision, created_at \
             FROM permissions ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AllowlistEntry {
                    tool_name: row.get(0)?,
                    scope_glob: row.get(1)?,
                    decision: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Clear allowlist. If `tool_name` is `Some`, only entries for that
    /// tool are removed; otherwise the whole table is wiped.
    pub fn clear_allowlist(&self, tool_name: Option<&str>) -> AgentResult<usize> {
        let conn = self.store.connection();
        let guard = conn
            .lock()
            .map_err(|_| AgentError::Internal("memory mutex poisoned".into()))?;
        let removed = if let Some(name) = tool_name {
            guard.execute(
                "DELETE FROM permissions WHERE tool_name = ?1",
                params![name],
            )?
        } else {
            guard.execute("DELETE FROM permissions", [])?
        };
        Ok(removed)
    }
}
