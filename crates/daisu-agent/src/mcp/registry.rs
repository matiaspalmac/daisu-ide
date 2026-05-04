//! Registry of connected MCP clients keyed by server name.
//!
//! `connect_all` is best-effort: a single misconfigured server should
//! not prevent the rest from coming up. Failures are returned per-name
//! so the Tauri layer can emit a status event for each.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::Mutex;

use crate::error::AgentResult;

use super::client::{McpClient, McpServerConfig, McpStatus};
use super::protocol::McpTool;

#[derive(Default)]
pub struct McpRegistry {
    clients: Mutex<HashMap<String, Arc<McpClient>>>,
}

/// Outcome of `connect_all`: per-server success or error message.
#[derive(Debug, Clone, Serialize)]
pub struct ConnectOutcome {
    pub name: String,
    pub ok: bool,
    pub error: Option<String>,
}

impl McpRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn connect(&self, config: McpServerConfig) -> AgentResult<Arc<McpClient>> {
        let name = config.name.clone();
        let client = McpClient::connect(config).await?;
        let mut guard = self.clients.lock().await;
        if let Some(prev) = guard.insert(name, client.clone()) {
            // Replaced an existing client — close the old one in the
            // background so we don't block the caller.
            tokio::spawn(async move { prev.close().await });
        }
        Ok(client)
    }

    /// Connect every enabled server. Errors are captured per-name; the
    /// returned vector is in the same order as `configs`. Disabled
    /// servers appear with `ok=false` and a `disabled` error so callers
    /// can render them uniformly without a separate filter.
    pub async fn connect_all(&self, configs: Vec<McpServerConfig>) -> Vec<ConnectOutcome> {
        let mut out = Vec::with_capacity(configs.len());
        for cfg in configs {
            let name = cfg.name.clone();
            if !cfg.enabled {
                out.push(ConnectOutcome {
                    name,
                    ok: false,
                    error: Some("disabled".into()),
                });
                continue;
            }
            match self.connect(cfg).await {
                Ok(_) => out.push(ConnectOutcome {
                    name,
                    ok: true,
                    error: None,
                }),
                Err(e) => out.push(ConnectOutcome {
                    name,
                    ok: false,
                    error: Some(e.to_string()),
                }),
            }
        }
        out
    }

    pub async fn disconnect(&self, name: &str) -> bool {
        // Take the client out of the map first, then drop the guard so
        // close() (which can block on the child process) doesn't hold
        // the registry mutex.
        let client = {
            let mut guard = self.clients.lock().await;
            guard.remove(name)
        };
        if let Some(client) = client {
            client.close().await;
            true
        } else {
            false
        }
    }

    pub async fn get(&self, name: &str) -> Option<Arc<McpClient>> {
        self.clients.lock().await.get(name).cloned()
    }

    /// Snapshot of every connected client's status.
    pub async fn statuses(&self) -> Vec<McpStatus> {
        let guard = self.clients.lock().await;
        let clients: Vec<_> = guard.values().cloned().collect();
        drop(guard);
        let mut out = Vec::with_capacity(clients.len());
        for c in clients {
            out.push(c.status().await);
        }
        out
    }

    /// Flat `(server_name, tool)` listing across every connected client.
    pub async fn tools(&self) -> Vec<(String, McpTool)> {
        let clients: Vec<_> = self.clients.lock().await.values().cloned().collect();
        let mut out = Vec::new();
        for c in clients {
            let server = c.name().to_string();
            for tool in c.list_tools().await {
                out.push((server.clone(), tool));
            }
        }
        out
    }
}
