//! `list_dir` tool — Auto tier. Returns non-hidden entries in a dir.
//!
//! Output is capped at `MAX_ENTRIES`; the envelope reports the cap so
//! the model knows to narrow the query rather than paginate forever.
//! Directories are listed before files (after both groups, alphabetised
//! ascending) so the model gets a stable, scan-friendly order.

use std::path::Path;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::dispatcher::{resolve_within, Tool};
use super::ToolDescriptor;
use crate::error::{AgentError, AgentResult};
use crate::permission::PermissionTier;

const MAX_ENTRIES: usize = 200;

#[derive(Debug, Deserialize)]
struct Args {
    path: String,
}

pub struct ListDir;

#[async_trait]
impl Tool for ListDir {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            name: "list_dir",
            description: "List entries in a workspace directory. Use \".\" for the root. Output is capped at 200 entries; if truncated:true, narrow the path.",
            tier: PermissionTier::Auto,
            input_schema: r#"{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}"#,
        }
    }

    async fn execute(&self, args: Value, cwd: &Path) -> AgentResult<Value> {
        let parsed: Args = serde_json::from_value(args)?;
        let path = resolve_within(cwd, &parsed.path).map_err(|e| match e {
            AgentError::PermissionDenied { reason, .. } => AgentError::PermissionDenied {
                tool: "list_dir".into(),
                reason,
            },
            other => other,
        })?;

        let path_for_blocking = path.clone();
        let (mut entries, total) = tokio::task::spawn_blocking(
            move || -> AgentResult<(Vec<(String, &'static str)>, usize)> {
                let mut all: Vec<(String, &'static str)> = Vec::new();
                for entry in std::fs::read_dir(&path_for_blocking)? {
                    let entry = entry?;
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.starts_with('.') || is_os_hidden(&entry).unwrap_or(false) {
                        continue;
                    }
                    let file_type = entry.file_type()?;
                    let kind = if file_type.is_dir() {
                        "dir"
                    } else if file_type.is_file() {
                        "file"
                    } else {
                        "other"
                    };
                    all.push((name, kind));
                }
                let total = all.len();
                all.sort_by(|a, b| {
                    // Dirs first, then files, then alphabetical.
                    let rank = |k: &str| match k {
                        "dir" => 0,
                        "file" => 1,
                        _ => 2,
                    };
                    rank(a.1).cmp(&rank(b.1)).then_with(|| a.0.cmp(&b.0))
                });
                Ok((all, total))
            },
        )
        .await
        .map_err(|e| AgentError::Internal(format!("join: {e}")))??;

        let truncated = entries.len() > MAX_ENTRIES;
        if truncated {
            entries.truncate(MAX_ENTRIES);
        }
        let json_entries: Vec<Value> = entries
            .into_iter()
            .map(|(name, kind)| json!({"name": name, "kind": kind}))
            .collect();

        let mut envelope = json!({
            "path": path.display().to_string(),
            "entries": json_entries,
            "total": total,
            "truncated": truncated,
        });
        if truncated {
            envelope["hint"] = json!(format!(
                "Showed first {} of {} entries. Narrow the path (e.g. list a subdirectory) or use grep/find_files for targeted search.",
                MAX_ENTRIES, total
            ));
        }
        Ok(envelope)
    }
}

#[cfg(target_os = "windows")]
fn is_os_hidden(entry: &std::fs::DirEntry) -> AgentResult<bool> {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
    let attrs = entry.metadata()?.file_attributes();
    Ok(attrs & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0)
}

#[cfg(not(target_os = "windows"))]
fn is_os_hidden(_entry: &std::fs::DirEntry) -> AgentResult<bool> {
    Ok(false)
}
