//! Tool dispatcher.
//!
//! Wires a name → [`Tool`] map, consults the [`PermissionGate`] for
//! Prompt/Sandbox-tier tools, and executes the call. Auto-tier tools
//! bypass the gate.
//!
//! All tools share a single async execute signature so the runtime
//! (Phase 1) can `await` a heterogeneous registry.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{registry, ToolDescriptor};
use crate::error::{AgentError, AgentResult};
use crate::permission::{PermissionGate, PermissionRequest, PermissionTier};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub arguments: Value,
}

/// Outcome of a tool dispatch.
///
/// Serialised externally-tagged so every variant becomes a JSON object
/// with a single `kind` field — this keeps the TS union exhaustive and
/// avoids the serde-internal-tag restriction on tuple variants.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolResult {
    Ok { value: Value },
    Denied { reason: String },
    Error { message: String },
}

impl ToolResult {
    fn ok(value: Value) -> Self {
        Self::Ok { value }
    }
    fn err(message: impl Into<String>) -> Self {
        Self::Error {
            message: message.into(),
        }
    }
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn descriptor(&self) -> ToolDescriptor;
    async fn execute(&self, args: Value, cwd: &Path) -> AgentResult<Value>;
}

pub struct ToolRegistry {
    tools: HashMap<&'static str, Arc<dyn Tool>>,
}

impl ToolRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    pub fn register(&mut self, tool: Arc<dyn Tool>) {
        let name = tool.descriptor().name;
        self.tools.insert(name, tool);
    }

    #[must_use]
    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(name).cloned()
    }

    #[must_use]
    pub fn descriptors(&self) -> Vec<ToolDescriptor> {
        registry()
    }

    /// Execute a tool call after consulting the permission gate.
    /// Auto-tier tools skip the gate; Prompt/Sandbox tools either match
    /// an existing allowlist entry or trigger an async approval flow.
    pub async fn dispatch(
        &self,
        call: ToolCall,
        gate: &PermissionGate,
        cwd: &Path,
        scope: &str,
    ) -> ToolResult {
        let Some(tool) = self.get(&call.name) else {
            return ToolResult::err(format!("unknown tool: {}", call.name));
        };
        let descriptor = tool.descriptor();

        if descriptor.tier != PermissionTier::Auto {
            match gate.is_allowed(&call.name, scope) {
                Ok(Some(decision)) if decision.is_allow() => {}
                Ok(Some(_)) => {
                    return ToolResult::Denied {
                        reason: "denied by allowlist".into(),
                    };
                }
                Ok(None) => {
                    let req = PermissionRequest {
                        tool_name: call.name.clone(),
                        scope: scope.to_string(),
                        tier: descriptor.tier,
                        summary: summarise_call(&call),
                    };
                    match gate.request_approval(req).await {
                        Ok(decision) if decision.is_allow() => {}
                        Ok(_) => {
                            return ToolResult::Denied {
                                reason: "user denied".into(),
                            };
                        }
                        Err(e) => return ToolResult::err(e.to_string()),
                    }
                }
                Err(e) => return ToolResult::err(e.to_string()),
            }
        }

        match tool.execute(call.arguments, cwd).await {
            Ok(value) => ToolResult::ok(value),
            Err(AgentError::PermissionDenied { reason, .. }) => ToolResult::Denied { reason },
            Err(e) => ToolResult::err(e.to_string()),
        }
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        let mut reg = Self::new();
        reg.register(Arc::new(super::read_file::ReadFile));
        reg.register(Arc::new(super::list_dir::ListDir));
        // Stubs — descriptors registered, executors return a typed
        // ToolExecution error until phase 2 wave 2 lands. They MUST
        // exist so descriptors() and the dispatcher can be exercised
        // end-to-end without panicking.
        for stub in [
            ("grep", PermissionTier::Auto),
            ("find_files", PermissionTier::Auto),
            ("git_status", PermissionTier::Auto),
            ("git_diff", PermissionTier::Auto),
            ("write_file", PermissionTier::Prompt),
            ("delete_file", PermissionTier::Prompt),
            ("run_command", PermissionTier::Sandbox),
        ] {
            reg.register(Arc::new(StubTool {
                name: stub.0,
                tier: stub.1,
            }));
        }
        reg
    }
}

fn summarise_call(call: &ToolCall) -> String {
    let body = call.arguments.to_string();
    let trimmed = if body.len() > 200 {
        format!("{}…", &body[..200])
    } else {
        body
    };
    format!("{}({trimmed})", call.name)
}

/// Placeholder tool: keeps the descriptor surface complete while the
/// real implementation is pending. `execute` returns a typed error so
/// callers see a clean message instead of a panic.
struct StubTool {
    name: &'static str,
    tier: PermissionTier,
}

#[async_trait]
impl Tool for StubTool {
    fn descriptor(&self) -> ToolDescriptor {
        // Look up the canonical descriptor from `registry()` so
        // descriptions stay single-sourced.
        registry()
            .into_iter()
            .find(|d| d.name == self.name)
            .unwrap_or(ToolDescriptor {
                name: self.name,
                description: "",
                tier: self.tier,
                input_schema: r#"{"type":"object"}"#,
            })
    }

    async fn execute(&self, _args: Value, _cwd: &Path) -> AgentResult<Value> {
        Err(AgentError::ToolExecution(format!(
            "tool '{}' is not yet implemented (M3 phase 2 wave 2)",
            self.name
        )))
    }
}

/// Resolve a path argument relative to `cwd` and forbid escaping.
///
/// Strategy:
/// 1. Build the candidate path (absolute or `cwd`-joined).
/// 2. Lexically normalise it: every `..` must be balanced by a prior
///    component, otherwise the path escapes regardless of whether
///    `canonicalize` happens to succeed.
/// 3. Canonicalise both candidate and `cwd` when possible. If the
///    candidate doesn't exist yet (write tools), fall back to the
///    normalised lexical path joined onto the canonical `cwd`.
/// 4. Verify the resulting absolute path starts with `cwd`.
pub(crate) fn resolve_within(cwd: &Path, raw: &str) -> AgentResult<PathBuf> {
    let candidate = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        cwd.join(raw)
    };
    let normalised = lexical_normalise(&candidate).ok_or_else(|| AgentError::PermissionDenied {
        tool: String::new(),
        reason: format!("path escapes workspace: {raw}"),
    })?;
    let cwd_canonical = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
    let resolved = normalised
        .canonicalize()
        .unwrap_or_else(|_| normalised.clone());
    if !resolved.starts_with(&cwd_canonical) && !normalised.starts_with(&cwd_canonical) {
        return Err(AgentError::PermissionDenied {
            tool: String::new(),
            reason: format!("path escapes workspace: {raw}"),
        });
    }
    Ok(resolved)
}

/// Lexically resolve `..` and `.` segments. Returns `None` when the
/// path tries to walk above its root (which always escapes).
fn lexical_normalise(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for component in path.components() {
        use std::path::Component;
        match component {
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    Some(out)
}
