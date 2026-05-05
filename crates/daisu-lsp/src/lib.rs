//! Daisu LSP — workspace-scoped language server multiplexor.
//!
//! Hand-rolled client over `lsp-types` + `tokio`, copying the layout
//! of `helix-editor/helix/tree/master/helix-lsp/src` (~2k LOC). No
//! framework dependency — `async-lsp`/`tower-lsp` have zero editor
//! consumers as of 2026, and `monaco-languageclient` drags ~10 MB of
//! `VSCode` runtime into the bundle.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::must_use_candidate,
    clippy::doc_markdown,
    clippy::type_complexity,
    clippy::match_same_arms,
    clippy::field_reassign_with_default,
    clippy::needless_pass_by_value,
    clippy::single_match_else,
    clippy::module_name_repetitions,
    clippy::assigning_clones,
    clippy::manual_let_else
)]

pub mod client;
pub mod config;
pub mod diagnostics;
pub mod discovery;
pub mod dispatcher;
pub mod framing;
pub mod handshake;
pub mod jsonrpc;
pub mod language;
pub mod lifecycle;
pub mod requests;
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

/// Boolean flags advertising which LSP navigation features the server
/// declared during the initialize handshake. Mirrored to the frontend so
/// Monaco providers register only when the server can actually answer.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavCapabilities {
    pub definition: bool,
    pub references: bool,
    pub document_symbol: bool,
    pub workspace_symbol: bool,
}

impl NavCapabilities {
    #[must_use]
    pub fn from_caps(caps: &lsp_types::ServerCapabilities) -> Self {
        Self {
            definition: caps.definition_provider.is_some(),
            references: caps.references_provider.is_some(),
            document_symbol: caps.document_symbol_provider.is_some(),
            workspace_symbol: caps.workspace_symbol_provider.is_some(),
        }
    }
}

slotmap::new_key_type! {
    /// Stable id assigned to a `(workspace, server_id)` pair. Used by
    /// the multiplexor to route messages and by the UI to reference a
    /// running server.
    pub struct LspId;
}

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use lsp_types::Uri;
use slotmap::SlotMap;
use tokio::sync::RwLock;

use crate::client::Client;
use crate::config::{LspConfig, ServerConfig};
use crate::diagnostics::DiagnosticsCache;
use crate::discovery::{resolve, Resolution};
use crate::handshake::file_uri;
use crate::lifecycle::Lifecycle;

/// Event broadcast on the manager's `ready_tx` channel whenever a server
/// completes its initialize handshake. Forwarded to the frontend as the
/// Tauri event `lsp://server-ready` (see `daisu_app::commands::lsp`).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerReadyEvent {
    pub server_id: String,
    pub languages: Vec<String>,
    pub capabilities: NavCapabilities,
}

pub struct LspManager {
    inner: Arc<RwLock<ManagerInner>>,
    pub diagnostics: Arc<DiagnosticsCache>,
    ready_tx: tokio::sync::broadcast::Sender<ServerReadyEvent>,
}

impl Default for LspManager {
    fn default() -> Self {
        let (ready_tx, _) = tokio::sync::broadcast::channel(64);
        Self {
            inner: Arc::default(),
            diagnostics: Arc::default(),
            ready_tx,
        }
    }
}

#[derive(Default)]
struct ManagerInner {
    servers: SlotMap<LspId, ServerSlot>,
    config: LspConfig,
    workspace: Option<PathBuf>,
    by_server_id: HashMap<String, LspId>,
    open_docs: HashMap<Uri, Vec<LspId>>,
}

pub struct ServerSlot {
    pub config: ServerConfig,
    pub resolution: Resolution,
    pub client: Option<Arc<Client>>,
    pub lifecycle: Option<Arc<Lifecycle>>,
    pub refcount: usize,
}

impl LspManager {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Subscribe to the broadcast channel that fires whenever a server
    /// completes the initialize handshake (lazy-spawn). Each subscriber
    /// receives every event from the moment of subscription.
    #[must_use]
    pub fn subscribe_ready(&self) -> tokio::sync::broadcast::Receiver<ServerReadyEvent> {
        self.ready_tx.subscribe()
    }

    pub async fn open_workspace(
        &self,
        workspace: PathBuf,
        config_path: &std::path::Path,
    ) -> LspResult<()> {
        let config = LspConfig::load(config_path)?;
        let mut inner = self.inner.write().await;
        inner.workspace = Some(workspace);
        inner.servers.clear();
        inner.by_server_id.clear();
        inner.open_docs.clear();
        for server in &config.servers {
            let resolution = resolve(server);
            let id = inner.servers.insert(ServerSlot {
                config: server.clone(),
                resolution,
                client: None,
                lifecycle: None,
                refcount: 0,
            });
            inner.by_server_id.insert(server.id.clone(), id);
        }
        inner.config = config;
        Ok(())
    }

    pub async fn open_document(&self, path: &std::path::Path, text: String) -> LspResult<()> {
        let language = match crate::language::language_for(path) {
            Some(l) => l,
            None => return Ok(()),
        };
        let uri = file_uri(path)?;
        let workspace = {
            let inner = self.inner.read().await;
            inner
                .workspace
                .clone()
                .ok_or_else(|| LspError::Rpc("no workspace open".into()))?
        };
        let candidates: Vec<LspId> = {
            let inner = self.inner.read().await;
            inner
                .servers
                .iter()
                .filter(|(_, s)| s.config.languages.iter().any(|l| l == language))
                .map(|(id, _)| id)
                .collect()
        };
        for id in candidates {
            self.ensure_client(id, &workspace).await?;
            let lifecycle = {
                let inner = self.inner.read().await;
                inner.servers.get(id).and_then(|s| s.lifecycle.clone())
            };
            if let Some(lc) = lifecycle {
                lc.did_open(uri.clone(), language.into(), text.clone())?;
            }
            let mut inner = self.inner.write().await;
            if let Some(slot) = inner.servers.get_mut(id) {
                slot.refcount += 1;
            }
            inner.open_docs.entry(uri.clone()).or_default().push(id);
        }
        Ok(())
    }

    pub async fn change_document(&self, path: &std::path::Path, new_text: String) -> LspResult<()> {
        let uri = file_uri(path)?;
        let lifecycles: Vec<Arc<Lifecycle>> = {
            let inner = self.inner.read().await;
            inner
                .open_docs
                .get(&uri)
                .map(|ids| {
                    ids.iter()
                        .filter_map(|id| inner.servers.get(*id).and_then(|s| s.lifecycle.clone()))
                        .collect()
                })
                .unwrap_or_default()
        };
        for lc in lifecycles {
            lc.did_change(uri.clone(), new_text.clone())?;
        }
        Ok(())
    }

    pub async fn close_document(&self, path: &std::path::Path) -> LspResult<()> {
        let uri = file_uri(path)?;
        let ids = {
            let mut inner = self.inner.write().await;
            inner.open_docs.remove(&uri).unwrap_or_default()
        };
        for id in ids {
            let lifecycle = {
                let inner = self.inner.read().await;
                inner.servers.get(id).and_then(|s| s.lifecycle.clone())
            };
            if let Some(lc) = lifecycle {
                lc.did_close(uri.clone())?;
            }
            let mut inner = self.inner.write().await;
            if let Some(slot) = inner.servers.get_mut(id) {
                slot.refcount = slot.refcount.saturating_sub(1);
            }
        }
        Ok(())
    }

    async fn ensure_client(&self, id: LspId, workspace: &std::path::Path) -> LspResult<()> {
        {
            let inner = self.inner.read().await;
            if inner
                .servers
                .get(id)
                .and_then(|s| s.client.as_ref())
                .is_some()
            {
                return Ok(());
            }
        }
        let (config, resolution) = {
            let inner = self.inner.read().await;
            let slot = inner
                .servers
                .get(id)
                .ok_or_else(|| LspError::Rpc("ensure_client: slot not found".into()))?;
            (slot.config.clone(), slot.resolution.clone())
        };
        let bin_path = match resolution {
            Resolution::Found(p) => p,
            Resolution::Missing => return Ok(()),
        };
        let client = Client::spawn(
            config.id.clone(),
            bin_path.to_string_lossy().as_ref(),
            &config.args,
            workspace,
            self.diagnostics.clone(),
        )
        .await?;
        let outgoing = client.outgoing.clone();
        let capabilities = NavCapabilities::from_caps(&client.capabilities());
        let arc = Arc::new(client);
        let lifecycle = Arc::new(Lifecycle::new(outgoing));
        {
            let mut inner = self.inner.write().await;
            if let Some(slot) = inner.servers.get_mut(id) {
                slot.client = Some(arc);
                slot.lifecycle = Some(lifecycle);
            }
        }
        // Best-effort broadcast — receivers may have all dropped during
        // a teardown. Frontend re-pulls statuses on the next poll either
        // way, so a missed event is recoverable.
        let _ = self.ready_tx.send(ServerReadyEvent {
            server_id: config.id.clone(),
            languages: config.languages.clone(),
            capabilities,
        });
        Ok(())
    }

    pub async fn statuses(&self) -> Vec<ServerStatus> {
        let inner = self.inner.read().await;
        inner
            .servers
            .iter()
            .map(|(id, slot)| {
                let capabilities = slot
                    .client
                    .as_ref()
                    .map(|c| NavCapabilities::from_caps(&c.capabilities()))
                    .unwrap_or_default();
                ServerStatus {
                    id,
                    server_id: slot.config.id.clone(),
                    languages: slot.config.languages.clone(),
                    resolution: match &slot.resolution {
                        Resolution::Found(p) => ResolutionPublic::Found(p.clone()),
                        Resolution::Missing => ResolutionPublic::Missing,
                    },
                    state: if slot.client.is_some() {
                        ServerState::Ready
                    } else {
                        ServerState::Idle
                    },
                    rss_mb: None,
                    capabilities,
                }
            })
            .collect()
    }

    pub async fn client_by_id(&self, server_id: &str) -> Option<Arc<Client>> {
        let inner = self.inner.read().await;
        inner
            .by_server_id
            .get(server_id)
            .and_then(|id| inner.servers.get(*id))
            .and_then(|slot| slot.client.clone())
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
    pub capabilities: NavCapabilities,
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

#[cfg(test)]
mod nav_capabilities_tests {
    use super::*;
    use lsp_types::{OneOf, ReferencesOptions, ServerCapabilities, WorkDoneProgressOptions};

    #[test]
    fn nav_capabilities_extracted_from_full_caps() {
        let caps = ServerCapabilities {
            definition_provider: Some(OneOf::Left(true)),
            references_provider: Some(OneOf::Left(true)),
            document_symbol_provider: Some(OneOf::Left(true)),
            workspace_symbol_provider: Some(OneOf::Left(true)),
            ..Default::default()
        };
        let nav = NavCapabilities::from_caps(&caps);
        assert!(nav.definition);
        assert!(nav.references);
        assert!(nav.document_symbol);
        assert!(nav.workspace_symbol);
    }

    #[test]
    fn nav_capabilities_default_when_provider_missing() {
        let caps = ServerCapabilities::default();
        let nav = NavCapabilities::from_caps(&caps);
        assert!(!nav.definition);
        assert!(!nav.references);
        assert!(!nav.document_symbol);
        assert!(!nav.workspace_symbol);
    }

    #[test]
    fn nav_capabilities_extracted_when_provider_uses_options() {
        let caps = ServerCapabilities {
            references_provider: Some(OneOf::Right(ReferencesOptions {
                work_done_progress_options: WorkDoneProgressOptions::default(),
            })),
            ..Default::default()
        };
        let nav = NavCapabilities::from_caps(&caps);
        assert!(nav.references);
    }

    #[tokio::test]
    async fn subscribe_ready_returns_receiver() {
        let mgr = LspManager::default();
        let _rx = mgr.subscribe_ready();
    }
}
