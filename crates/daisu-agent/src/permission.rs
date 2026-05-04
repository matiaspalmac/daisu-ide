//! Permission gate for tool calls.
//!
//! Tools have a tier (Auto / Prompt / Sandbox). Auto tools execute
//! without asking. Prompt tools must be approved via the UI; the
//! decision can be persisted as an allowlist entry. Sandbox tools
//! always prompt and run with a constrained working directory.
//!
//! The runtime fills in `request_approval` with a Tauri-driven
//! channel; this module only owns the decision logic.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionTier {
    Auto,
    Prompt,
    Sandbox,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    AllowOnce,
    AllowAlways,
    Deny,
    DenyAlways,
}

impl Decision {
    #[must_use]
    pub fn is_allow(&self) -> bool {
        matches!(self, Self::AllowOnce | Self::AllowAlways)
    }

    #[must_use]
    pub fn persists(&self) -> bool {
        matches!(self, Self::AllowAlways | Self::DenyAlways)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    pub tool_name: String,
    pub scope: String,
    pub tier: PermissionTier,
    pub summary: String,
}
