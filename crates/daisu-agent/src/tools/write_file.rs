//! `write_file` tool — Prompt tier. Creates or replaces a UTF-8 file inside
//! the workspace. The dispatcher gates this behind a permission prompt so
//! the user always sees the path + content summary before disk is touched.

use std::path::Path;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::dispatcher::{resolve_within, Tool};
use super::ToolDescriptor;
use crate::error::{AgentError, AgentResult};
use crate::permission::PermissionTier;

const MAX_BYTES: usize = 1_048_576; // 1 MiB

#[derive(Debug, Deserialize)]
struct Args {
    path: String,
    contents: String,
}

pub struct WriteFile;

#[async_trait]
impl Tool for WriteFile {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            name: "write_file",
            description: "Write or replace a file (UTF-8). Requires approval.",
            tier: PermissionTier::Prompt,
            input_schema: r#"{"type":"object","properties":{"path":{"type":"string"},"contents":{"type":"string"}},"required":["path","contents"],"additionalProperties":false}"#,
        }
    }

    async fn execute(&self, args: Value, cwd: &Path) -> AgentResult<Value> {
        let parsed: Args = serde_json::from_value(args)?;
        if parsed.contents.len() > MAX_BYTES {
            return Err(AgentError::ToolExecution(format!(
                "contents too large: {} bytes (max {MAX_BYTES})",
                parsed.contents.len()
            )));
        }
        let path = resolve_within(cwd, &parsed.path).map_err(|e| match e {
            AgentError::PermissionDenied { reason, .. } => AgentError::PermissionDenied {
                tool: "write_file".into(),
                reason,
            },
            other => other,
        })?;

        let path_for_blocking = path.clone();
        let bytes = parsed.contents.len() as u64;
        tokio::task::spawn_blocking(move || -> AgentResult<()> {
            if let Some(parent) = path_for_blocking.parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent)?;
                }
            }
            std::fs::write(&path_for_blocking, parsed.contents.as_bytes())?;
            Ok(())
        })
        .await
        .map_err(|e| AgentError::Internal(format!("join: {e}")))??;

        Ok(json!({
            "path": path.display().to_string(),
            "bytes": bytes,
        }))
    }
}
