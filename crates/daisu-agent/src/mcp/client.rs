//! High-level MCP client: spawn transport, run `initialize` handshake,
//! then expose `list_tools` / `call_tool` etc.

use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::process::Command;
use tokio::sync::RwLock;

use crate::error::{AgentError, AgentResult};

use super::protocol::{
    methods, ClientInfo, InitializeParams, InitializeResult, McpTool, McpToolResult, Request,
    RequestId, RpcError, ToolsListResult,
};
use super::transport::{StdioTransport, Transport};

/// Transport selection for an MCP server. Stdio is the default; SSE is
/// stubbed for the scaffold.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpTransportKind {
    #[default]
    Stdio,
    Sse,
}

/// Configuration for a single MCP server.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpServerConfig {
    pub name: String,
    #[serde(default)]
    pub transport: McpTransportKind,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

/// Status snapshot for UI display.
#[derive(Debug, Clone, Serialize)]
pub struct McpStatus {
    pub name: String,
    pub connected: bool,
    pub tool_count: usize,
}

/// High-level client. Cheap to clone via `Arc`.
pub struct McpClient {
    name: String,
    transport: Arc<dyn Transport>,
    next_id: AtomicU64,
    tools: RwLock<Vec<McpTool>>,
}

impl McpClient {
    /// Spawn the configured transport and complete the MCP `initialize`
    /// handshake. On any failure the child process (if any) is killed
    /// before the error propagates to the caller.
    pub async fn connect(config: McpServerConfig) -> AgentResult<Arc<Self>> {
        let transport: Arc<dyn Transport> = match config.transport {
            McpTransportKind::Stdio => {
                if config.command.trim().is_empty() {
                    return Err(AgentError::Internal(format!(
                        "mcp server {}: stdio transport requires a command",
                        config.name
                    )));
                }
                let mut cmd = Command::new(&config.command);
                cmd.args(&config.args)
                    .envs(&config.env)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .kill_on_drop(true);
                let mut child = cmd.spawn().map_err(|e| {
                    AgentError::Internal(format!(
                        "mcp server {}: failed to spawn '{}': {e}",
                        config.name, config.command
                    ))
                })?;
                // Drain stderr in the background so a chatty MCP server
                // can't deadlock by filling the pipe buffer. We don't
                // surface the lines yet; future work routes them to a
                // tauri log channel.
                if let Some(stderr) = child.stderr.take() {
                    let server_name = config.name.clone();
                    tokio::spawn(async move {
                        use tokio::io::{AsyncBufReadExt, BufReader};
                        let mut lines = BufReader::new(stderr).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            eprintln!("[mcp:{server_name}] {line}");
                        }
                    });
                }
                StdioTransport::spawn(child)?
            }
            McpTransportKind::Sse => {
                return Err(AgentError::Internal(
                    "mcp sse transport not yet implemented".into(),
                ));
            }
        };

        let me = Arc::new(Self {
            name: config.name.clone(),
            transport,
            next_id: AtomicU64::new(1),
            tools: RwLock::new(Vec::new()),
        });

        // Initialize handshake.
        let init_params = InitializeParams {
            protocol_version: "2024-11-05".into(),
            capabilities: serde_json::json!({}),
            client_info: ClientInfo {
                name: "daisu-ide".into(),
                version: env!("CARGO_PKG_VERSION").into(),
            },
        };
        let init_value = serde_json::to_value(&init_params)?;
        let init_result: InitializeResult = me.request(methods::INITIALIZE, init_value).await?;
        let _ = init_result; // currently unused beyond confirming success

        // Notify server we're ready (per spec, the client sends the
        // `notifications/initialized` notification after a successful
        // initialize).
        let initialized = serde_json::json!({
            "jsonrpc": "2.0",
            "method": methods::INITIALIZED,
            "params": {}
        });
        let _ = me.transport.notify(initialized).await;

        // Best-effort: prime the tools cache.
        if let Ok(tools) = me.fetch_tools().await {
            *me.tools.write().await = tools;
        }

        Ok(me)
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    fn next_id(&self) -> RequestId {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    async fn request<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Value,
    ) -> AgentResult<T> {
        let id = self.next_id();
        let req = Request::new(id, method, Some(params));
        let payload = serde_json::to_value(&req)?;
        let raw = self.transport.send(id, payload).await?;

        if let Some(err) = raw.get("error") {
            let parsed: RpcError =
                serde_json::from_value(err.clone()).unwrap_or_else(|_| RpcError {
                    code: -32000,
                    message: err.to_string(),
                    data: None,
                });
            return Err(AgentError::Provider(format!(
                "mcp[{}] {}: {} (code {})",
                self.name, method, parsed.message, parsed.code
            )));
        }
        let result = raw.get("result").cloned().unwrap_or(Value::Null);
        let parsed: T = serde_json::from_value(result)?;
        Ok(parsed)
    }

    async fn fetch_tools(&self) -> AgentResult<Vec<McpTool>> {
        let res: ToolsListResult = self
            .request(methods::TOOLS_LIST, serde_json::json!({}))
            .await?;
        Ok(res.tools)
    }

    /// Cached tool list captured during `connect`.
    pub async fn list_tools(&self) -> Vec<McpTool> {
        self.tools.read().await.clone()
    }

    /// Force a fresh `tools/list` round-trip and update the cache.
    pub async fn refresh_tools(&self) -> AgentResult<Vec<McpTool>> {
        let tools = self.fetch_tools().await?;
        *self.tools.write().await = tools.clone();
        Ok(tools)
    }

    pub async fn call_tool(&self, name: &str, arguments: Value) -> AgentResult<McpToolResult> {
        let params = serde_json::json!({ "name": name, "arguments": arguments });
        self.request(methods::TOOLS_CALL, params).await
    }

    pub async fn close(&self) {
        self.transport.close().await;
    }

    pub async fn status(&self) -> McpStatus {
        McpStatus {
            name: self.name.clone(),
            connected: true,
            tool_count: self.tools.read().await.len(),
        }
    }
}
