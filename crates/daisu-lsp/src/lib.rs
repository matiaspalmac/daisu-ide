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
/// `struct_excessive_bools` is allowed here intentionally — the shape
/// mirrors the LSP `ServerCapabilities` provider flags 1:1.
#[allow(clippy::struct_excessive_bools)]
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

/// Boolean flags advertising which LSP mutation features the server
/// declared during the initialize handshake. Mirrors `NavCapabilities`
/// for the write-side request set used by M4.2c (rename + format).
/// Same `struct_excessive_bools` rationale: 1:1 with LSP provider flags.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationCapabilities {
    pub rename: bool,
    pub prepare_rename: bool,
    pub document_formatting: bool,
    pub range_formatting: bool,
}

impl MutationCapabilities {
    #[must_use]
    pub fn from_caps(caps: &lsp_types::ServerCapabilities) -> Self {
        let (rename, prepare_rename) = match &caps.rename_provider {
            None => (false, false),
            Some(lsp_types::OneOf::Left(b)) => (*b, false),
            Some(lsp_types::OneOf::Right(opts)) => (true, opts.prepare_provider.unwrap_or(false)),
        };
        Self {
            rename,
            prepare_rename,
            document_formatting: caps.document_formatting_provider.is_some(),
            range_formatting: caps.document_range_formatting_provider.is_some(),
        }
    }
}

/// Boolean flags advertising which LSP "advanced" (path-C extras) features
/// the server declared during the initialize handshake. Same allow-list
/// rationale as `NavCapabilities` / `MutationCapabilities`: 1:1 mirror of
/// LSP provider flags.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedCapabilities {
    pub inlay_hint: bool,
    pub inlay_hint_resolve: bool,
    pub semantic_tokens_full: bool,
    pub code_action: bool,
    pub code_action_resolve: bool,
    pub execute_command: bool,
}

impl AdvancedCapabilities {
    #[must_use]
    pub fn from_caps(caps: &lsp_types::ServerCapabilities) -> Self {
        let (inlay_hint, inlay_hint_resolve) = match &caps.inlay_hint_provider {
            None => (false, false),
            Some(lsp_types::OneOf::Left(b)) => (*b, false),
            Some(lsp_types::OneOf::Right(server_caps)) => {
                let resolve = match server_caps {
                    lsp_types::InlayHintServerCapabilities::Options(opts) => {
                        opts.resolve_provider.unwrap_or(false)
                    }
                    lsp_types::InlayHintServerCapabilities::RegistrationOptions(opts) => {
                        opts.inlay_hint_options.resolve_provider.unwrap_or(false)
                    }
                };
                (true, resolve)
            }
        };
        let semantic_tokens_full = caps.semantic_tokens_provider.as_ref().is_some_and(|p| {
            let full = match p {
                lsp_types::SemanticTokensServerCapabilities::SemanticTokensOptions(o) => &o.full,
                lsp_types::SemanticTokensServerCapabilities::SemanticTokensRegistrationOptions(
                    o,
                ) => &o.semantic_tokens_options.full,
            };
            matches!(
                full,
                Some(
                    lsp_types::SemanticTokensFullOptions::Bool(true)
                        | lsp_types::SemanticTokensFullOptions::Delta { .. }
                )
            )
        });
        let (code_action, code_action_resolve) = match &caps.code_action_provider {
            None => (false, false),
            Some(lsp_types::CodeActionProviderCapability::Simple(b)) => (*b, false),
            Some(lsp_types::CodeActionProviderCapability::Options(opts)) => {
                (true, opts.resolve_provider.unwrap_or(false))
            }
        };
        Self {
            inlay_hint,
            inlay_hint_resolve,
            semantic_tokens_full,
            code_action,
            code_action_resolve,
            execute_command: caps.execute_command_provider.is_some(),
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
    pub mutation: MutationCapabilities,
    pub advanced: AdvancedCapabilities,
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
    /// Last spawn or handshake failure for this slot. Populated by
    /// `ensure_client` when `Client::spawn` returns Err and surfaced via
    /// `ServerStatus.last_error`. Without this the UI sees the slot stuck
    /// in `Idle` with no actionable signal — same symptom as a server
    /// that simply hasn't been needed yet.
    pub last_error: Option<String>,
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

    /// Open (or re-open) a workspace. Returns `true` when the workspace
    /// transitioned from "not open" or "different workspace" to opened —
    /// callers use this to gate one-shot side effects (emitting
    /// `lsp://workspace-opened`, redirecting tracked Monaco models). For
    /// repeated calls with the same path this is a no-op and returns
    /// `false`, preserving running clients across StrictMode double-mounts
    /// and chip remounts.
    pub async fn open_workspace(
        &self,
        workspace: PathBuf,
        config_path: &std::path::Path,
    ) -> LspResult<bool> {
        // Fast path under read lock — avoids unnecessary config IO when
        // the workspace is already open.
        {
            let inner = self.inner.read().await;
            if inner.workspace.as_deref() == Some(workspace.as_path()) {
                return Ok(false);
            }
        }
        let config = LspConfig::load(config_path)?;
        let mut inner = self.inner.write().await;
        // Re-check under the write lock — another task could have raced.
        if inner.workspace.as_deref() == Some(workspace.as_path()) {
            return Ok(false);
        }
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
                last_error: None,
            });
            inner.by_server_id.insert(server.id.clone(), id);
        }
        inner.config = config;
        Ok(true)
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
            Resolution::Missing => {
                // Discovery already failed — record so the UI surfaces
                // "binary not found" instead of the slot lingering in
                // Idle indefinitely. Reported as `last_error` because
                // `Resolution::Missing` is also a status field, but the
                // human-readable hint helps less-technical users.
                let mut inner = self.inner.write().await;
                if let Some(slot) = inner.servers.get_mut(id) {
                    slot.last_error =
                        Some(format!("command not found on PATH: {}", config.command));
                }
                return Ok(());
            }
        };
        let client = match Client::spawn(
            config.id.clone(),
            bin_path.to_string_lossy().as_ref(),
            &config.args,
            workspace,
            self.diagnostics.clone(),
        )
        .await
        {
            Ok(c) => c,
            Err(e) => {
                // Persist the failure so subsequent `statuses()` calls
                // promote the slot from Idle to Crashed and the UI can
                // render the underlying error (handshake timeout, server
                // exited, EOF before initialize, etc.).
                let err_str = e.to_string();
                {
                    let mut inner = self.inner.write().await;
                    if let Some(slot) = inner.servers.get_mut(id) {
                        slot.last_error = Some(err_str);
                    }
                }
                return Err(e);
            }
        };
        let outgoing = client.outgoing.clone();
        let capabilities = NavCapabilities::from_caps(&client.capabilities());
        let mutation = MutationCapabilities::from_caps(&client.capabilities());
        let advanced = AdvancedCapabilities::from_caps(&client.capabilities());
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
            mutation,
            advanced,
        });
        Ok(())
    }

    pub async fn statuses(&self) -> Vec<ServerStatus> {
        let inner = self.inner.read().await;
        inner
            .servers
            .iter()
            .map(|(id, slot)| {
                let caps_snapshot = slot.client.as_ref().map(|c| c.capabilities());
                let capabilities = caps_snapshot
                    .as_ref()
                    .map(|c| NavCapabilities::from_caps(c))
                    .unwrap_or_default();
                let mutation = caps_snapshot
                    .as_ref()
                    .map(|c| MutationCapabilities::from_caps(c))
                    .unwrap_or_default();
                let advanced = caps_snapshot
                    .as_ref()
                    .map(|c| AdvancedCapabilities::from_caps(c))
                    .unwrap_or_default();
                let state = if slot.client.is_some() {
                    ServerState::Ready
                } else if slot.last_error.is_some() {
                    ServerState::Crashed
                } else {
                    ServerState::Idle
                };
                ServerStatus {
                    id,
                    server_id: slot.config.id.clone(),
                    languages: slot.config.languages.clone(),
                    resolution: match &slot.resolution {
                        Resolution::Found(p) => ResolutionPublic::Found { path: p.clone() },
                        Resolution::Missing => ResolutionPublic::Missing,
                    },
                    state,
                    rss_mb: None,
                    capabilities,
                    mutation,
                    advanced,
                    last_error: slot.last_error.clone(),
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
    pub mutation: MutationCapabilities,
    pub advanced: AdvancedCapabilities,
    /// Human-readable failure context when `state` is `Crashed`. The
    /// frontend renders this in a status-bar banner so users can act on
    /// the actual cause (e.g., "Unknown binary 'rust-analyzer'") rather
    /// than wondering why hovers do nothing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResolutionPublic {
    // Struct variant (not tuple) — `#[serde(tag = ...)]` only supports
    // internally-tagged enums when each variant is a struct. The previous
    // `Found(PathBuf)` form compiled but failed at runtime with
    // "cannot serialize tagged newtype variant ResolutionPublic::Found
    // containing a string", silently breaking `lsp_servers_status` and
    // every Monaco LSP provider downstream of it.
    Found { path: PathBuf },
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

    #[test]
    fn mutation_capabilities_extracted_from_bool_rename_provider() {
        let caps = ServerCapabilities {
            rename_provider: Some(OneOf::Left(true)),
            document_formatting_provider: Some(OneOf::Left(true)),
            document_range_formatting_provider: Some(OneOf::Left(true)),
            ..Default::default()
        };
        let mutation = MutationCapabilities::from_caps(&caps);
        assert!(mutation.rename);
        assert!(!mutation.prepare_rename);
        assert!(mutation.document_formatting);
        assert!(mutation.range_formatting);
    }

    #[test]
    fn mutation_capabilities_detects_prepare_provider_in_rename_options() {
        let caps = ServerCapabilities {
            rename_provider: Some(OneOf::Right(lsp_types::RenameOptions {
                prepare_provider: Some(true),
                work_done_progress_options: WorkDoneProgressOptions::default(),
            })),
            ..Default::default()
        };
        let mutation = MutationCapabilities::from_caps(&caps);
        assert!(mutation.rename);
        assert!(mutation.prepare_rename);
    }

    #[test]
    fn mutation_capabilities_default_when_no_providers() {
        let caps = ServerCapabilities::default();
        let mutation = MutationCapabilities::from_caps(&caps);
        assert!(!mutation.rename);
        assert!(!mutation.prepare_rename);
        assert!(!mutation.document_formatting);
        assert!(!mutation.range_formatting);
    }

    #[test]
    fn advanced_capabilities_default_when_no_providers() {
        let caps = ServerCapabilities::default();
        let advanced = AdvancedCapabilities::from_caps(&caps);
        assert!(!advanced.inlay_hint);
        assert!(!advanced.inlay_hint_resolve);
        assert!(!advanced.semantic_tokens_full);
        assert!(!advanced.code_action);
        assert!(!advanced.code_action_resolve);
        assert!(!advanced.execute_command);
    }

    #[test]
    fn advanced_capabilities_extracted_from_bool_provider() {
        let caps = ServerCapabilities {
            inlay_hint_provider: Some(OneOf::Left(true)),
            code_action_provider: Some(lsp_types::CodeActionProviderCapability::Simple(true)),
            execute_command_provider: Some(lsp_types::ExecuteCommandOptions::default()),
            ..Default::default()
        };
        let advanced = AdvancedCapabilities::from_caps(&caps);
        assert!(advanced.inlay_hint);
        assert!(!advanced.inlay_hint_resolve);
        assert!(advanced.code_action);
        assert!(!advanced.code_action_resolve);
        assert!(advanced.execute_command);
    }

    #[test]
    fn advanced_capabilities_detects_resolve_providers() {
        let caps = ServerCapabilities {
            inlay_hint_provider: Some(OneOf::Right(
                lsp_types::InlayHintServerCapabilities::Options(lsp_types::InlayHintOptions {
                    resolve_provider: Some(true),
                    work_done_progress_options: WorkDoneProgressOptions::default(),
                }),
            )),
            code_action_provider: Some(lsp_types::CodeActionProviderCapability::Options(
                lsp_types::CodeActionOptions {
                    resolve_provider: Some(true),
                    code_action_kinds: None,
                    work_done_progress_options: WorkDoneProgressOptions::default(),
                },
            )),
            ..Default::default()
        };
        let advanced = AdvancedCapabilities::from_caps(&caps);
        assert!(advanced.inlay_hint);
        assert!(advanced.inlay_hint_resolve);
        assert!(advanced.code_action);
        assert!(advanced.code_action_resolve);
    }

    #[test]
    fn resolution_public_serializes_found_with_kind_and_path() {
        // Regression: `#[serde(tag = "kind")]` cannot serialize tuple
        // newtype variants holding a primitive. Frontend type expects
        // `{ kind: "found", path: string }` — anything else collapses
        // `lsp_servers_status` into a JSON error and silently disables
        // every Monaco LSP provider.
        let r = ResolutionPublic::Found {
            path: std::path::PathBuf::from("/usr/bin/rust-analyzer"),
        };
        let v = serde_json::to_value(&r).expect("ResolutionPublic must serialize");
        assert_eq!(v["kind"], "found");
        assert_eq!(v["path"], "/usr/bin/rust-analyzer");
    }

    #[test]
    fn resolution_public_serializes_missing_with_kind_only() {
        let r = ResolutionPublic::Missing;
        let v = serde_json::to_value(&r).expect("ResolutionPublic must serialize");
        assert_eq!(v["kind"], "missing");
        assert!(v.get("path").is_none());
    }

    #[test]
    fn advanced_capabilities_detects_semantic_tokens_full() {
        let caps = ServerCapabilities {
            semantic_tokens_provider: Some(
                lsp_types::SemanticTokensServerCapabilities::SemanticTokensOptions(
                    lsp_types::SemanticTokensOptions {
                        full: Some(lsp_types::SemanticTokensFullOptions::Bool(true)),
                        legend: lsp_types::SemanticTokensLegend {
                            token_types: vec![],
                            token_modifiers: vec![],
                        },
                        range: None,
                        work_done_progress_options: WorkDoneProgressOptions::default(),
                    },
                ),
            ),
            ..Default::default()
        };
        let advanced = AdvancedCapabilities::from_caps(&caps);
        assert!(advanced.semantic_tokens_full);
    }
}
