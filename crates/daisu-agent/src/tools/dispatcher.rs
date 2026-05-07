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

use super::ToolDescriptor;
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
    /// Compiled JSON-Schema validators per tool, keyed by the same name
    /// used in `tools`. Built once at `register()` and reused on every
    /// dispatch — `jsonschema-rs` measures 75–645× faster than `valico`
    /// in compile-once-validate-many use. A failed compile leaves the
    /// validator missing; dispatch falls through to lenient mode for
    /// that one tool with a single eprintln, so a malformed schema
    /// degrades to "model can call but isn't pre-validated" rather than
    /// "tool is unreachable".
    validators: HashMap<&'static str, jsonschema::Validator>,
}

impl ToolRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            validators: HashMap::new(),
        }
    }

    pub fn register(&mut self, tool: Arc<dyn Tool>) {
        let descriptor = tool.descriptor();
        let name = descriptor.name;
        self.tools.insert(name, tool);
        match serde_json::from_str::<Value>(descriptor.input_schema)
            .map_err(|e| e.to_string())
            .and_then(|schema| jsonschema::validator_for(&schema).map_err(|e| e.to_string()))
        {
            Ok(v) => {
                self.validators.insert(name, v);
            }
            Err(e) => {
                eprintln!(
                    "agent: tool {name} input_schema failed to compile — {e}; pre-dispatch validation disabled"
                );
            }
        }
    }

    #[must_use]
    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(name).cloned()
    }

    #[must_use]
    pub fn descriptors(&self) -> Vec<ToolDescriptor> {
        // Source from the actually registered tools so we never advertise
        // a name the dispatcher can't resolve. The descriptor objects come
        // from each tool's own `descriptor()` impl, which keeps wording
        // single-sourced even after wave-2 tools graduate from stubs.
        self.tools.values().map(|t| t.descriptor()).collect()
    }

    /// Execute a tool call after consulting the permission gate.
    /// Auto-tier tools skip the gate; Prompt/Sandbox tools either match
    /// an existing allowlist entry or trigger an async approval flow.
    pub async fn dispatch(
        &self,
        mut call: ToolCall,
        gate: &PermissionGate,
        cwd: &Path,
        scope: &str,
    ) -> ToolResult {
        // Normalise the name before lookup so models that emit camelCase,
        // kebab-case or namespaced variants (`functions.read_file`,
        // `readFile`, `read-file`) still resolve. Mirrors the fallback
        // parser pass at agent.rs::normalize_tool_name; kept independent
        // here because cloud providers route through `dispatch` directly.
        call.name = normalize_tool_name_inplace(&call.name);
        let Some(tool) = self.get(&call.name) else {
            return ToolResult::err(format!("unknown tool: {}", call.name));
        };
        let descriptor = tool.descriptor();

        // Pre-dispatch JSON-Schema validation. Surfaces exact JSON-pointer
        // paths to the model on the very next turn (e.g.
        // `/path: "" is shorter than minimum length 1`). Skipped silently
        // if the schema didn't compile — see register() for details.
        if let Some(validator) = self.validators.get(descriptor.name) {
            let errors: Vec<String> = validator
                .iter_errors(&call.arguments)
                .take(5) // cap so a 50-error blowup doesn't drown the model
                .map(|e| format!("{}: {}", e.instance_path, e))
                .collect();
            if !errors.is_empty() {
                return ToolResult::err(format!(
                    "schema validation failed for {}: {}",
                    call.name,
                    errors.join("; ")
                ));
            }
        }

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
        reg.register(Arc::new(super::write_file::WriteFile));
        // Unimplemented tools (grep/git_status/find_files/run_command/...) are
        // intentionally NOT registered. Advertising them to the model only
        // teaches it to pick names that fail at dispatch time. Wave 2 will
        // register real impls; until then the model sees the working subset.
        reg
    }
}

/// Normalise a tool name into snake_case. See agent.rs::normalize_tool_name
/// for full rules; this is the daisu-agent-local copy (the crate boundary
/// makes sharing awkward, and the function is small).
fn normalize_tool_name_inplace(raw: &str) -> String {
    let mut s = raw.trim();
    if let Some(idx) = s.rfind("::") {
        s = &s[idx + 2..];
    }
    if let Some(idx) = s.rfind('.') {
        s = &s[idx + 1..];
    }
    let mut out = String::with_capacity(s.len() + 4);
    let mut prev_lower_or_digit = false;
    for c in s.chars() {
        if c == '-' || c == '_' || c.is_whitespace() {
            if !out.ends_with('_') {
                out.push('_');
            }
            prev_lower_or_digit = false;
        } else if c.is_uppercase() {
            if prev_lower_or_digit && !out.ends_with('_') {
                out.push('_');
            }
            for low in c.to_lowercase() {
                out.push(low);
            }
            prev_lower_or_digit = false;
        } else {
            out.push(c);
            prev_lower_or_digit = c.is_lowercase() || c.is_ascii_digit();
        }
    }
    out.trim_matches('_').to_string()
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
    if let Some(reason) = reject_windows_path_traps(raw) {
        return Err(AgentError::PermissionDenied {
            tool: String::new(),
            reason: format!("{reason}: {raw}"),
        });
    }
    // Coerce common shapes models emit by accident: forward-slash on
    // Windows, workspace-absolute paths that just happen to share the
    // cwd prefix. Both become workspace-relative before resolution.
    let coerced = coerce_to_relative(cwd, raw);
    let candidate = if Path::new(&coerced).is_absolute() {
        PathBuf::from(&coerced)
    } else {
        cwd.join(&coerced)
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

/// Reject Windows-only path traps that bypass `canonicalize` (verbatim
/// namespace `\\?\`, device namespace `\\.\`, UNC `\\server\share`) and
/// reserved DOS device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9 — opening
/// any of these on Windows opens a device, not a file). Returns Some(reason)
/// when the path should be rejected.
const RESERVED_DOS_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

fn reject_windows_path_traps(raw: &str) -> Option<&'static str> {
    let lower = raw.to_ascii_lowercase();
    if lower.starts_with(r"\\?\") || lower.starts_with(r"\\.\") {
        return Some("verbatim/device-namespace path not allowed");
    }
    if lower.starts_with(r"\\") {
        return Some("UNC path not allowed");
    }
    let stem = std::path::Path::new(&lower)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if RESERVED_DOS_NAMES
        .iter()
        .any(|r| stem.eq_ignore_ascii_case(r))
    {
        return Some("reserved Windows device name");
    }
    None
}

/// Coerce well-meaning model mistakes into the canonical relative form:
/// - workspace-absolute paths (`C:\Proyectos\foo\src\main.rs` when
///   workspace = `C:\Proyectos\foo`) → `src\main.rs`.
/// - forward slashes on Windows → backslashes.
///
/// Anything that doesn't match either case passes through unchanged.
fn coerce_to_relative(cwd: &Path, raw: &str) -> String {
    let normalised_seps = if cfg!(windows) {
        raw.replace('/', "\\")
    } else {
        raw.to_string()
    };
    if let Ok(cwd_canon) = cwd.canonicalize() {
        let cwd_str = cwd_canon.to_string_lossy().to_string();
        let lower_cwd = cwd_str.to_ascii_lowercase();
        let lower_raw = normalised_seps.to_ascii_lowercase();
        if lower_raw.starts_with(&lower_cwd) {
            let rel = &normalised_seps[cwd_str.len()..];
            return rel
                .trim_start_matches(std::path::MAIN_SEPARATOR)
                .to_string();
        }
    }
    normalised_seps
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
