//! MCP transports. Two impls: stdio (line-delimited JSON over a child
//! process) and SSE (stub for the scaffold).
//!
//! The transport layer is intentionally narrow: send a single JSON
//! request, await its matching response. Higher-level dispatch and
//! initialization live in `client.rs`.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::{oneshot, Mutex};

use crate::error::{AgentError, AgentResult};

use super::protocol::{IncomingMessage, RequestId};

type PendingMap = Arc<Mutex<HashMap<RequestId, oneshot::Sender<Value>>>>;

/// Transport contract used by `McpClient`.
#[async_trait]
pub trait Transport: Send + Sync {
    /// Send a JSON-RPC request payload (with an `id`) and wait for the
    /// matching response. Returns the raw JSON value the server sent
    /// back as the full response object.
    async fn send(&self, id: RequestId, msg: Value) -> AgentResult<Value>;

    /// Send a JSON-RPC notification (no response expected).
    async fn notify(&self, msg: Value) -> AgentResult<()>;

    /// Close transport. Best-effort; idempotent.
    async fn close(&self);
}

/// Line-delimited JSON-RPC over a child process's stdin/stdout.
pub struct StdioTransport {
    stdin: Mutex<ChildStdin>,
    pending: PendingMap,
    child: Mutex<Option<Child>>,
}

impl StdioTransport {
    /// Spawn a child process configured by the caller and wire stdio.
    ///
    /// The caller is responsible for setting `stdin/stdout/stderr` to
    /// `Stdio::piped()` as needed and applying env/args.
    pub fn spawn(mut child: Child) -> AgentResult<Arc<Self>> {
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AgentError::Internal("mcp child missing stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AgentError::Internal("mcp child missing stdout".into()))?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let me = Arc::new(Self {
            stdin: Mutex::new(stdin),
            pending: pending.clone(),
            child: Mutex::new(Some(child)),
        });

        let reader = BufReader::new(stdout);
        tokio::spawn(reader_loop(reader, pending));

        Ok(me)
    }
}

async fn reader_loop(mut reader: BufReader<ChildStdout>, pending: PendingMap) {
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) | Err(_) => break, // EOF or read error
            Ok(_) => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: Result<IncomingMessage, _> = serde_json::from_str(trimmed);
        match parsed {
            Ok(IncomingMessage::Response(resp)) => {
                let id = resp.id;
                let mut guard = pending.lock().await;
                if let Some(tx) = guard.remove(&id) {
                    // Re-serialize as Value so callers can inspect either
                    // result or error uniformly.
                    if let Ok(v) = serde_json::to_value(&resp) {
                        let _ = tx.send(v);
                    }
                }
            }
            Ok(IncomingMessage::Notification(_n)) => {
                // Notifications are not surfaced beyond this scaffold.
            }
            Err(_) => {
                // Malformed line; skip.
            }
        }
    }
    // Drain remaining waiters with a synthetic error so they don't hang.
    let mut guard = pending.lock().await;
    for (_, tx) in guard.drain() {
        let _ = tx.send(serde_json::json!({
            "id": 0,
            "error": { "code": -32000, "message": "transport closed" }
        }));
    }
}

#[async_trait]
impl Transport for StdioTransport {
    async fn send(&self, id: RequestId, msg: Value) -> AgentResult<Value> {
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(id, tx);
        }
        let mut buf = serde_json::to_vec(&msg)?;
        buf.push(b'\n');
        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(&buf).await?;
            stdin.flush().await?;
        }
        rx.await
            .map_err(|_| AgentError::Internal("mcp transport dropped".into()))
    }

    async fn notify(&self, msg: Value) -> AgentResult<()> {
        let mut buf = serde_json::to_vec(&msg)?;
        buf.push(b'\n');
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(&buf).await?;
        stdin.flush().await?;
        Ok(())
    }

    async fn close(&self) {
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
    }
}

/// Stub SSE transport. Phase 5 only ships stdio; SSE lands later.
pub struct SseTransport;

#[async_trait]
impl Transport for SseTransport {
    async fn send(&self, _id: RequestId, _msg: Value) -> AgentResult<Value> {
        Err(AgentError::Internal(
            "mcp sse transport not yet implemented".into(),
        ))
    }

    async fn notify(&self, _msg: Value) -> AgentResult<()> {
        Err(AgentError::Internal(
            "mcp sse transport not yet implemented".into(),
        ))
    }

    async fn close(&self) {}
}
