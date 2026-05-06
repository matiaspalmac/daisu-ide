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

use std::path::PathBuf;
use std::sync::Arc;

use slotmap::SlotMap;
use tokio::sync::RwLock;

use crate::config::{LspConfig, ServerConfig};
use crate::discovery::{resolve, Resolution};

/// Multiplexor: tracks all running LSP server clients keyed by
/// `(workspace, server_id)`. M4.0 only stores config + resolution
/// state; M4.1 wires real `Client` instances in.
#[derive(Default)]
pub struct LspManager {
    inner: Arc<RwLock<ManagerInner>>,
}

#[derive(Default)]
struct ManagerInner {
    servers: SlotMap<LspId, ServerSlot>,
    config: LspConfig,
    workspace: Option<PathBuf>,
}

/// One configured server. M4.0 holds resolution state only; the
/// `client` field is added in M4.1 once `Client` exists.
#[derive(Debug)]
pub struct ServerSlot {
    pub config: ServerConfig,
    pub resolution: Resolution,
}

impl LspManager {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Bind the manager to a workspace and load its config. The
    /// workspace path **must** already be trusted; callers should
    /// check `trust::is_trusted` before invoking this.
    pub async fn open_workspace(
        &self,
        workspace: PathBuf,
        config_path: &std::path::Path,
    ) -> LspResult<()> {
        let config = LspConfig::load(config_path)?;
        let mut inner = self.inner.write().await;
        inner.workspace = Some(workspace);
        inner.servers.clear();
        for server in &config.servers {
            let resolution = resolve(server);
            inner.servers.insert(ServerSlot {
                config: server.clone(),
                resolution,
            });
        }
        inner.config = config;
        Ok(())
    }

    pub async fn statuses(&self) -> Vec<ServerStatus> {
        let inner = self.inner.read().await;
        inner
            .servers
            .iter()
            .map(|(id, slot)| ServerStatus {
                id,
                server_id: slot.config.id.clone(),
                languages: slot.config.languages.clone(),
                resolution: match &slot.resolution {
                    Resolution::Found(p) => ResolutionPublic::Found(p.clone()),
                    Resolution::Missing => ResolutionPublic::Missing,
                },
                state: ServerState::Idle,
                rss_mb: None,
            })
            .collect()
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    #[serde(skip)]
    pub id: LspId,
    pub server_id: String,
    pub languages: Vec<String>,
    pub resolution: ResolutionPublic,
    pub state: ServerState,
    pub rss_mb: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResolutionPublic {
    Found(PathBuf),
    Missing,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ServerState {
    Idle,
    Spawning,
    Ready,
    Crashed,
}
