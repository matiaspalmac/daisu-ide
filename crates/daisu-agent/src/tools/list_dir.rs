//! `list_dir` tool — Auto tier. Returns non-hidden entries in a dir.

use std::path::Path;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::dispatcher::{resolve_within, Tool};
use super::ToolDescriptor;
use crate::error::{AgentError, AgentResult};
use crate::permission::PermissionTier;

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
            description: "List entries in a workspace directory.",
            tier: PermissionTier::Auto,
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
        let entries = tokio::task::spawn_blocking(move || -> AgentResult<Vec<Value>> {
            let mut out = Vec::new();
            for entry in std::fs::read_dir(&path_for_blocking)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') || is_os_hidden(&entry).unwrap_or(false) {
                    continue;
                }
                let file_type = entry.file_type()?;
                out.push(json!({
                    "name": name,
                    "kind": if file_type.is_dir() { "dir" } else if file_type.is_file() { "file" } else { "other" },
                }));
            }
            Ok(out)
        })
        .await
        .map_err(|e| AgentError::Internal(format!("join: {e}")))??;

        Ok(json!({
            "path": path.display().to_string(),
            "entries": entries,
        }))
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
