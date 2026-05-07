//! `read_file` tool — Auto tier. Reads a UTF-8 file under the workspace.
//!
//! Output envelope is paginated so a 50K-line source doesn't blow the
//! model's context. `offset` and `limit` follow Claude Code conventions
//! (0-indexed line offset, default 2000-line cap). Lines longer than
//! `MAX_LINE_CHARS` are truncated mid-line so a minified bundle can't
//! drop a single line that's millions of characters wide.

use std::path::Path;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::dispatcher::{resolve_within, Tool};
use super::ToolDescriptor;
use crate::error::{AgentError, AgentResult};
use crate::permission::PermissionTier;

const MAX_BYTES: u64 = 1_048_576; // 1 MiB
const MAX_LINES_DEFAULT: usize = 2_000;
const MAX_LINE_CHARS: usize = 2_000;

#[derive(Debug, Deserialize)]
struct Args {
    path: String,
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    limit: Option<usize>,
}

pub struct ReadFile;

#[async_trait]
impl Tool for ReadFile {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            name: "read_file",
            description: "Read a UTF-8 file. For files >2000 lines, pass offset (0-indexed) + limit; the result envelope reports total_lines and truncated.",
            tier: PermissionTier::Auto,
            input_schema: r#"{
                "type":"object",
                "properties": {
                    "path": {"type":"string", "description":"Workspace-relative file path"},
                    "offset": {"type":"integer", "minimum":0, "description":"0-indexed line to start from (default 0)"},
                    "limit": {"type":"integer", "minimum":1, "maximum":2000, "description":"Max lines to return (default 2000, hard cap 2000)"}
                },
                "required":["path"],
                "additionalProperties": false
            }"#,
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

        let offset = parsed.offset.unwrap_or(0);
        let limit = parsed
            .limit
            .unwrap_or(MAX_LINES_DEFAULT)
            .min(MAX_LINES_DEFAULT);

        let path_for_blocking = path.clone();
        let (bytes, total_lines, contents, truncated_long_lines) =
            tokio::task::spawn_blocking(move || -> AgentResult<(u64, usize, String, bool)> {
                let meta = std::fs::metadata(&path_for_blocking)?;
                if meta.len() > MAX_BYTES {
                    return Err(AgentError::ToolExecution(format!(
                        "file too large: {} bytes (max {MAX_BYTES})",
                        meta.len()
                    )));
                }
                let raw = std::fs::read_to_string(&path_for_blocking)?;
                let lines: Vec<&str> = raw.lines().collect();
                let total = lines.len();
                let mut buf = String::with_capacity(raw.len().min(64 * 1024));
                let mut any_long_truncated = false;
                for line in lines.iter().skip(offset).take(limit) {
                    if line.chars().count() > MAX_LINE_CHARS {
                        any_long_truncated = true;
                        let cut: String = line.chars().take(MAX_LINE_CHARS).collect();
                        buf.push_str(&cut);
                        buf.push_str("…[line truncated]");
                    } else {
                        buf.push_str(line);
                    }
                    buf.push('\n');
                }
                Ok((meta.len(), total, buf, any_long_truncated))
            })
            .await
            .map_err(|e| AgentError::Internal(format!("join: {e}")))??;

        let shown_end = offset.saturating_add(limit).min(total_lines);
        let truncated = total_lines > shown_end || truncated_long_lines;
        let mut envelope = json!({
            "path": path.display().to_string(),
            "bytes": bytes,
            "total_lines": total_lines,
            "shown_lines": [offset, shown_end],
            "truncated": truncated,
            "contents": contents,
        });
        if truncated {
            envelope["hint"] = json!(format!(
                "Showed {} of {} lines. Re-call with offset/limit to see the rest.",
                shown_end - offset.min(shown_end),
                total_lines
            ));
        }
        Ok(envelope)
    }
}
