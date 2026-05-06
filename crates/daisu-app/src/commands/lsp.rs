//! Tauri command bridge for `daisu-lsp` (M4.1).

#![allow(
    clippy::needless_pass_by_value,
    clippy::missing_errors_doc,
    clippy::unused_async
)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use lsp_types::{
    CompletionItem, CompletionParams, CompletionResponse, Hover, HoverParams, Position,
    SignatureHelp, SignatureHelpParams, TextDocumentIdentifier, TextDocumentPositionParams, Uri,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, State};

use daisu_lsp::{requests, trust, ServerStatus};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

const DIAGNOSTICS_EVENT: &str = "agent://lsp-diagnostics";

fn map_lsp(e: daisu_lsp::LspError) -> AppError {
    AppError::Internal(format!("lsp: {e}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePath {
    pub workspace_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustState {
    pub trusted: bool,
}

#[tauri::command]
pub async fn lsp_workspace_is_trusted(req: WorkspacePath) -> AppResult<TrustState> {
    let p = PathBuf::from(&req.workspace_path);
    let trusted = trust::is_trusted(&p).map_err(map_lsp)?;
    Ok(TrustState { trusted })
}

#[tauri::command]
pub async fn lsp_workspace_trust(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: WorkspacePath,
) -> AppResult<TrustState> {
    let p = PathBuf::from(&req.workspace_path);
    trust::grant(&p).map_err(map_lsp)?;
    let config_path = home_lsp_config_path();
    state
        .lsp_manager
        .open_workspace(p, &config_path)
        .await
        .map_err(map_lsp)?;
    start_diagnostics_emitter(&app, &state);
    Ok(TrustState { trusted: true })
}

#[tauri::command]
pub async fn lsp_workspace_revoke(req: WorkspacePath) -> AppResult<TrustState> {
    let p = PathBuf::from(&req.workspace_path);
    trust::revoke(&p).map_err(map_lsp)?;
    Ok(TrustState { trusted: false })
}

#[tauri::command]
pub async fn lsp_servers_status(state: State<'_, AppState>) -> AppResult<Vec<ServerStatus>> {
    Ok(state.lsp_manager.statuses().await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOpenReq {
    pub path: String,
    pub text: String,
}

#[tauri::command]
pub async fn lsp_document_open(state: State<'_, AppState>, req: DocumentOpenReq) -> AppResult<()> {
    state
        .lsp_manager
        .open_document(&PathBuf::from(&req.path), req.text)
        .await
        .map_err(map_lsp)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChangeReq {
    pub path: String,
    pub text: String,
}

#[tauri::command]
pub async fn lsp_document_change(
    state: State<'_, AppState>,
    req: DocumentChangeReq,
) -> AppResult<()> {
    state
        .lsp_manager
        .change_document(&PathBuf::from(&req.path), req.text)
        .await
        .map_err(map_lsp)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCloseReq {
    pub path: String,
}

#[tauri::command]
pub async fn lsp_document_close(
    state: State<'_, AppState>,
    req: DocumentCloseReq,
) -> AppResult<()> {
    state
        .lsp_manager
        .close_document(&PathBuf::from(&req.path))
        .await
        .map_err(map_lsp)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionReq {
    pub path: String,
    pub line: u32,
    pub character: u32,
    pub server_id: Option<String>,
}

fn position_params(req: &PositionReq) -> Result<TextDocumentPositionParams, AppError> {
    use std::str::FromStr;
    let url = url::Url::from_file_path(PathBuf::from(&req.path))
        .map_err(|()| AppError::Internal(format!("bad path: {}", req.path)))?;
    let uri =
        Uri::from_str(url.as_str()).map_err(|e| AppError::Internal(format!("bad uri: {e}")))?;
    Ok(TextDocumentPositionParams {
        text_document: TextDocumentIdentifier { uri },
        position: Position::new(req.line, req.character),
    })
}

async fn first_running_client(
    state: &AppState,
    req: &PositionReq,
) -> Result<std::sync::Arc<daisu_lsp::client::Client>, AppError> {
    if let Some(server_id) = req.server_id.as_deref() {
        return state
            .lsp_manager
            .client_by_id(server_id)
            .await
            .ok_or_else(|| AppError::Internal(format!("no running client for {server_id}")));
    }
    for status in state.lsp_manager.statuses().await {
        if matches!(status.state, daisu_lsp::ServerState::Ready) {
            if let Some(c) = state.lsp_manager.client_by_id(&status.server_id).await {
                return Ok(c);
            }
        }
    }
    Err(AppError::Internal("no running lsp client".into()))
}

#[tauri::command]
pub async fn lsp_completion(
    state: State<'_, AppState>,
    req: PositionReq,
) -> AppResult<Option<CompletionResponse>> {
    let pos = position_params(&req)?;
    let client = first_running_client(&state, &req).await?;
    let params = CompletionParams {
        text_document_position: pos,
        work_done_progress_params: lsp_types::WorkDoneProgressParams::default(),
        partial_result_params: lsp_types::PartialResultParams::default(),
        context: None,
    };
    let (res, _) = requests::completion(client, params)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

#[tauri::command]
pub async fn lsp_completion_resolve(
    state: State<'_, AppState>,
    server_id: String,
    item: Value,
) -> AppResult<CompletionItem> {
    let client = state
        .lsp_manager
        .client_by_id(&server_id)
        .await
        .ok_or_else(|| AppError::Internal(format!("no client {server_id}")))?;
    let parsed: CompletionItem =
        serde_json::from_value(item).map_err(|e| AppError::Internal(format!("item: {e}")))?;
    let (resolved, _) = requests::completion_resolve(client, parsed)
        .await
        .map_err(map_lsp)?;
    Ok(resolved)
}

#[tauri::command]
pub async fn lsp_hover(state: State<'_, AppState>, req: PositionReq) -> AppResult<Option<Hover>> {
    let pos = position_params(&req)?;
    let client = first_running_client(&state, &req).await?;
    let params = HoverParams {
        text_document_position_params: pos,
        work_done_progress_params: lsp_types::WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::hover(client, params).await.map_err(map_lsp)?;
    Ok(res.0)
}

#[tauri::command]
pub async fn lsp_signature_help(
    state: State<'_, AppState>,
    req: PositionReq,
) -> AppResult<Option<SignatureHelp>> {
    let pos = position_params(&req)?;
    let client = first_running_client(&state, &req).await?;
    let params = SignatureHelpParams {
        text_document_position_params: pos,
        work_done_progress_params: lsp_types::WorkDoneProgressParams::default(),
        context: None,
    };
    let (res, _) = requests::signature_help(client, params)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

fn home_lsp_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".daisu")
        .join("lsp.toml")
}

static EMITTER_STARTED: AtomicBool = AtomicBool::new(false);

fn start_diagnostics_emitter(app: &tauri::AppHandle, state: &AppState) {
    if EMITTER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    let mut sub = state.lsp_manager.diagnostics.subscribe();
    tokio::spawn(async move {
        while let Ok(ev) = sub.recv().await {
            let _ = app.emit(DIAGNOSTICS_EVENT, &ev);
        }
    });
}
