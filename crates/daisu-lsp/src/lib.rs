//! Daisu LSP — workspace-scoped language server multiplexor.
//!
//! Hand-rolled client over `lsp-types` + `tokio`, copying the layout
//! of `helix-editor/helix/tree/master/helix-lsp/src` (~2k LOC). No
//! framework dependency — `async-lsp`/`tower-lsp` have zero editor
//! consumers as of 2026, and `monaco-languageclient` drags ~10 MB of
//! `VSCode` runtime into the bundle.

#![allow(clippy::missing_errors_doc, clippy::missing_panics_doc)]

pub mod config;
pub mod discovery;
pub mod framing;
pub mod jsonrpc;
pub mod transport;
pub mod trust;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum LspError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("toml: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("framing: {0}")]
    Framing(String),
    #[error("rpc: {0}")]
    Rpc(String),
    #[error("trust: {0}")]
    Trust(String),
    #[error("server not found: {0}")]
    ServerNotFound(String),
}

pub type LspResult<T> = Result<T, LspError>;

slotmap::new_key_type! {
    /// Stable id assigned to a `(workspace, server_id)` pair. Used by
    /// the multiplexor to route messages and by the UI to reference a
    /// running server.
    pub struct LspId;
}
