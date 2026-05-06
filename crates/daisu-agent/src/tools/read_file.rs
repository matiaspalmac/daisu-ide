//! `read_file` tool — Auto tier. Reads a UTF-8 file under the workspace.

use std::path::Path;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::dispatcher::{resolve_within, Tool};
use super::ToolDescriptor;
use crate::error::{AgentError, AgentResult};
use crate::permission::PermissionTier;

const MAX_BYTES: u64 = 1_048_576; // 1 MiB

#[derive(Debug, Deserialize)]
struct Args {
    path: String,
}

pub struct ReadFile;

#[async_trait]
impl Tool for ReadFile {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            name: "read_file",
            description: "Read a file from the workspace as UTF-8.",
            tier: PermissionTier::Auto,
            input_schema: r#"{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}"#,
        }
    }

    async fn execute(&self, args: Value, cwd: &Path) -> AgentResult<Value> {
        let parsed: Args = serde_json::from_value(args)?;
        let path = resolve_within(cwd, &parsed.path).map_err(|e| match e {
            AgentError::PermissionDenied { reason, .. } => AgentError::PermissionDenied {
                tool: "read_file".into(),
                reason,
            },
            other => other,
        })?;

        let path_for_blocking = path.clone();
        let (bytes, contents) =
            tokio::task::spawn_blocking(move || -> AgentResult<(u64, String)> {
                let meta = std::fs::metadata(&path_for_blocking)?;
                if meta.len() > MAX_BYTES {
                    return Err(AgentError::ToolExecution(format!(
                        "file too large: {} bytes (max {MAX_BYTES})",
                        meta.len()
                    )));
                }
                let contents = std::fs::read_to_string(&path_for_blocking)?;
                Ok((meta.len(), contents))
            })
            .await
            .map_err(|e| AgentError::Internal(format!("join: {e}")))??;

        Ok(json!({
            "path": path.display().to_string(),
            "bytes": bytes,
            "contents": contents,
        }))
    }
}
