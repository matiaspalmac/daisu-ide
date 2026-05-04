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

use serde::{Deserialize, Serialize};

use crate::permission::PermissionTier;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDescriptor {
    pub name: &'static str,
    pub description: &'static str,
    pub tier: PermissionTier,
}

#[must_use]
pub fn registry() -> Vec<ToolDescriptor> {
    vec![
        ToolDescriptor {
            name: "read_file",
            description: "Read a file from the workspace as UTF-8.",
            tier: PermissionTier::Auto,
        },
        ToolDescriptor {
            name: "list_dir",
            description: "List entries in a workspace directory.",
            tier: PermissionTier::Auto,
        },
        ToolDescriptor {
            name: "grep",
            description: "Search file contents by regex inside the workspace.",
            tier: PermissionTier::Auto,
        },
        ToolDescriptor {
            name: "find_files",
            description: "Find files by glob pattern.",
            tier: PermissionTier::Auto,
        },
        ToolDescriptor {
            name: "git_status",
            description: "Report git working tree status.",
            tier: PermissionTier::Auto,
        },
        ToolDescriptor {
            name: "git_diff",
            description: "Show diff for a path or the whole working tree.",
            tier: PermissionTier::Auto,
        },
        ToolDescriptor {
            name: "write_file",
            description: "Write or replace a file (UTF-8). Requires approval.",
            tier: PermissionTier::Prompt,
        },
        ToolDescriptor {
            name: "delete_file",
            description: "Move a file to the system trash. Requires approval.",
            tier: PermissionTier::Prompt,
        },
        ToolDescriptor {
            name: "run_command",
            description: "Run a shell command sandboxed to the workspace.",
            tier: PermissionTier::Sandbox,
        },
    ]
}

pub use dispatcher::{Tool, ToolCall, ToolRegistry, ToolResult};
