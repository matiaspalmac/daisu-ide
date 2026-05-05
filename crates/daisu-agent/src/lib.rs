//! Daisu Agent — provider abstraction, runtime, tools, and memory for
//! the M3 agent-native milestone.
//!
//! Public surface is intentionally small: pick a provider, build an
//! `AgentRuntime`, drive conversations through it. The Tauri command
//! layer in `daisu-app` is the only consumer outside this crate.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

pub mod error;
pub mod index;
pub mod keychain;
pub mod mcp;
pub mod memory;
pub mod permission;
pub mod provider;
pub mod runtime;
pub mod tools;

pub use error::{AgentError, AgentResult};
pub use mcp::{
    ConnectOutcome, McpClient, McpRegistry, McpServerConfig, McpStatus, McpTool, McpToolResult,
    McpTransportKind,
};
pub use permission::{
    AllowlistEntry, Decision, EventEmitter, NoopEmitter, PermissionGate, PermissionRequest,
    PermissionRequestEvent, PermissionTier,
};
pub use provider::{
    CompletionRequest, CompletionResponse, LlmProvider, Message, ModelInfo, ProviderId, Role,
    StreamEvent,
};
pub use tools::{Tool, ToolCall, ToolDescriptor, ToolRegistry, ToolResult};
