//! Model Context Protocol client (M3 Phase 5 scaffold).
//!
//! Public surface:
//!   - [`McpClient`] — connect to a single server, list/call tools.
//!   - [`McpRegistry`] — manage many clients keyed by server name.
//!   - [`McpServerConfig`] — what the UI persists in settings.
//!   - [`McpTool`] / [`McpToolResult`] — wire types.
//!
//! Two transports exist: `stdio` (line-delimited JSON over a child
//! process, fully implemented) and `sse` (stub — returns
//! "not yet implemented" and is documented as future work).

pub mod client;
pub mod protocol;
pub mod registry;
pub mod transport;

pub use client::{McpClient, McpServerConfig, McpStatus, McpTransportKind};
pub use protocol::{McpTool, McpToolResult};
pub use registry::{ConnectOutcome, McpRegistry};
