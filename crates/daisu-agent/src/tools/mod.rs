//! Tool registry and dispatcher.
//!
//! Phase 2 lands the dispatcher + permission plumbing. Real tool
//! bodies for read-only Auto-tier tools are implemented here; the
//! Prompt/Sandbox-tier tools register descriptors and stubbed
//! executors so the surface is callable while the heavy work
//! arrives in later phases.

pub mod dispatcher;
pub mod list_dir;
pub mod read_file;
pub mod write_file;

pub mod propose_edit;

pub use propose_edit::{apply_accepted_hunks, compute_hunks, EditHunk, ProposeEdit};

use serde::{Deserialize, Serialize};

use crate::permission::PermissionTier;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDescriptor {
    pub name: &'static str,
    pub description: &'static str,
    pub tier: PermissionTier,
    /// JSON Schema describing the tool's input. Stored as a string so
    /// the registry stays `const`-able; parsed into a `serde_json::Value`
    /// at the boundary that hands tools to an `LlmProvider`.
    pub input_schema: &'static str,
}

/// Tool catalogue. Schemas pass `additionalProperties: false` and an
/// explicit `required` array — both prerequisites for OpenAI / Anthropic
/// strict mode (grammar-constrained sampling that prevents hallucinated
/// keys like `file_path` instead of `path`). When `additionalProperties`
/// is omitted, OpenAI strict mode rejects the tool with
/// `"<tool> is not strict"`.
#[must_use]
pub fn registry() -> Vec<ToolDescriptor> {
    vec![
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
        },
        ToolDescriptor {
            name: "list_dir",
            description: "List entries in a workspace directory. Use \".\" for the root.",
            tier: PermissionTier::Auto,
            input_schema: r#"{
                "type":"object",
                "properties": {
                    "path": {"type":"string", "description":"Workspace-relative directory path; use \".\" for root"}
                },
                "required":["path"],
                "additionalProperties": false
            }"#,
        },
        ToolDescriptor {
            name: "grep",
            description: "Search file contents by regex inside the workspace.",
            tier: PermissionTier::Auto,
            input_schema: r#"{
                "type":"object",
                "properties": {
                    "pattern": {"type":"string", "description":"Regex pattern"},
                    "path": {"type":"string", "description":"Optional path to restrict search to"},
                    "case_sensitive": {"type":"boolean", "description":"Default false"}
                },
                "required":["pattern","path","case_sensitive"],
                "additionalProperties": false
            }"#,
        },
        ToolDescriptor {
            name: "find_files",
            description: "Find files by glob pattern.",
            tier: PermissionTier::Auto,
            input_schema: r#"{
                "type":"object",
                "properties": {
                    "pattern": {"type":"string", "description":"Glob like **/*.ts"}
                },
                "required":["pattern"],
                "additionalProperties": false
            }"#,
        },
        ToolDescriptor {
            name: "search_symbols",
            description: "Search the workspace symbol index (functions, types, classes).",
            tier: PermissionTier::Auto,
            input_schema: r#"{
                "type":"object",
                "properties": {
                    "query": {"type":"string"},
                    "limit": {"type":"integer"}
                },
                "required":["query","limit"],
                "additionalProperties": false
            }"#,
        },
        ToolDescriptor {
            name: "git_status",
            description: "Report git working tree status.",
            tier: PermissionTier::Auto,
            input_schema: r#"{"type":"object","properties":{},"additionalProperties":false}"#,
        },
        ToolDescriptor {
            name: "git_diff",
            description: "Show diff for a path or the whole working tree.",
            tier: PermissionTier::Auto,
            input_schema: r#"{
                "type":"object",
                "properties": {
                    "path": {"type":"string", "description":"Optional path filter; pass empty string for whole tree"}
                },
                "required":["path"],
                "additionalProperties": false
            }"#,
        },
        ToolDescriptor {
            name: "write_file",
            description: "Write or replace a file (UTF-8). Requires approval.",
            tier: PermissionTier::Prompt,
            input_schema: r#"{
                "type":"object",
                "properties": {
                    "path": {"type":"string"},
                    "contents": {"type":"string"}
                },
                "required":["path","contents"],
                "additionalProperties": false
            }"#,
        },
        ToolDescriptor {
            name: "delete_file",
            description: "Move a file to the system trash. Requires approval.",
            tier: PermissionTier::Prompt,
            input_schema: r#"{
                "type":"object",
                "properties": {
                    "path": {"type":"string"}
                },
                "required":["path"],
                "additionalProperties": false
            }"#,
        },
        ToolDescriptor {
            name: "propose_edit",
            description: "Propose a hunk-by-hunk edit to a file. Requires approval; nothing is written until accepted.",
            tier: PermissionTier::Prompt,
            input_schema: r#"{
                "type":"object",
                "properties": {
                    "path": {"type":"string"},
                    "new_text": {"type":"string", "description":"Full new file contents"}
                },
                "required":["path","new_text"],
                "additionalProperties": false
            }"#,
        },
        ToolDescriptor {
            name: "run_command",
            description: "Run a shell command sandboxed to the workspace.",
            tier: PermissionTier::Sandbox,
            input_schema: r#"{
                "type":"object",
                "properties": {
                    "command": {"type":"string", "description":"Shell command to run"}
                },
                "required":["command"],
                "additionalProperties": false
            }"#,
        },
    ]
}

pub use dispatcher::{Tool, ToolCall, ToolRegistry, ToolResult};
