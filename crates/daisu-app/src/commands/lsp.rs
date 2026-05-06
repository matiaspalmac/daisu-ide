//! Tauri command bridge for `daisu-lsp` (M4.1).

#![allow(
    clippy::needless_pass_by_value,
    clippy::missing_errors_doc,
    clippy::unused_async
)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use lsp_types::{
    CodeAction, CodeActionContext, CodeActionOrCommand, CodeActionParams, CompletionItem,
    CompletionParams, CompletionResponse, DocumentFormattingParams, DocumentRangeFormattingParams,
    DocumentSymbolParams, DocumentSymbolResponse, ExecuteCommandParams, FormattingOptions,
    GotoDefinitionParams, GotoDefinitionResponse, Hover, HoverParams, InlayHint, InlayHintParams,
    Location, PartialResultParams, Position, PrepareRenameResponse, Range, ReferenceContext,
    ReferenceParams, RenameParams, SemanticTokensParams, SemanticTokensResult, SignatureHelp,
    SignatureHelpParams, TextDocumentIdentifier, TextDocumentPositionParams, TextEdit, Uri,
    WorkDoneProgressParams, WorkspaceEdit, WorkspaceSymbolParams, WorkspaceSymbolResponse,
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
    start_server_ready_emitter(&app, &state);
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
static READY_EMITTER_STARTED: AtomicBool = AtomicBool::new(false);

const SERVER_READY_EVENT: &str = "lsp://server-ready";

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

fn start_server_ready_emitter(app: &tauri::AppHandle, state: &AppState) {
    if READY_EMITTER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    let mut sub = state.lsp_manager.subscribe_ready();
    tokio::spawn(async move {
        while let Ok(ev) = sub.recv().await {
            let _ = app.emit(SERVER_READY_EVENT, &ev);
        }
    });
}

#[tauri::command]
pub async fn lsp_definition(
    state: State<'_, AppState>,
    req: PositionReq,
) -> AppResult<Option<GotoDefinitionResponse>> {
    let pos = position_params(&req)?;
    let client = first_running_client(&state, &req).await?;
    let params = GotoDefinitionParams {
        text_document_position_params: pos,
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    };
    let (res, _) = requests::definition(client, params)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferencesReq {
    pub path: String,
    pub line: u32,
    pub character: u32,
    #[serde(default)]
    pub server_id: Option<String>,
    pub include_declaration: bool,
}

#[tauri::command]
pub async fn lsp_references(
    state: State<'_, AppState>,
    req: ReferencesReq,
) -> AppResult<Vec<Location>> {
    let pos_req = PositionReq {
        path: req.path.clone(),
        line: req.line,
        character: req.character,
        server_id: req.server_id.clone(),
    };
    let pos = position_params(&pos_req)?;
    let client = first_running_client(&state, &pos_req).await?;
    let params = ReferenceParams {
        text_document_position: pos,
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
        context: ReferenceContext {
            include_declaration: req.include_declaration,
        },
    };
    let (locs, _) = requests::references(client, params)
        .await
        .map_err(map_lsp)?;
    Ok(locs)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSymbolReq {
    pub path: String,
    #[serde(default)]
    pub server_id: Option<String>,
}

#[tauri::command]
pub async fn lsp_document_symbol(
    state: State<'_, AppState>,
    req: DocumentSymbolReq,
) -> AppResult<Option<DocumentSymbolResponse>> {
    use std::str::FromStr;
    let url = url::Url::from_file_path(PathBuf::from(&req.path))
        .map_err(|()| AppError::Internal(format!("bad path: {}", req.path)))?;
    let uri =
        Uri::from_str(url.as_str()).map_err(|e| AppError::Internal(format!("bad uri: {e}")))?;
    let pos_req = PositionReq {
        path: req.path.clone(),
        line: 0,
        character: 0,
        server_id: req.server_id.clone(),
    };
    let client = first_running_client(&state, &pos_req).await?;
    let params = DocumentSymbolParams {
        text_document: TextDocumentIdentifier { uri },
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    };
    let (res, _) = requests::document_symbol(client, params)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSymbolReq {
    pub query: String,
    pub server_id: String,
}

#[tauri::command]
pub async fn lsp_workspace_symbol(
    state: State<'_, AppState>,
    req: WorkspaceSymbolReq,
) -> AppResult<Option<WorkspaceSymbolResponse>> {
    let client = state
        .lsp_manager
        .client_by_id(&req.server_id)
        .await
        .ok_or_else(|| AppError::Internal(format!("no client for {}", req.server_id)))?;
    let params = WorkspaceSymbolParams {
        query: req.query,
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    };
    let (res, _) = requests::workspace_symbol(client, params)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

#[tauri::command]
pub async fn lsp_prepare_rename(
    state: State<'_, AppState>,
    req: PositionReq,
) -> AppResult<Option<PrepareRenameResponse>> {
    let pos = position_params(&req)?;
    let client = first_running_client(&state, &req).await?;
    let (res, _) = requests::prepare_rename(client, pos)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameReq {
    pub path: String,
    pub line: u32,
    pub character: u32,
    #[serde(default)]
    pub server_id: Option<String>,
    pub new_name: String,
}

#[tauri::command]
pub async fn lsp_rename(
    state: State<'_, AppState>,
    req: RenameReq,
) -> AppResult<Option<WorkspaceEdit>> {
    let pos_req = PositionReq {
        path: req.path.clone(),
        line: req.line,
        character: req.character,
        server_id: req.server_id.clone(),
    };
    let pos = position_params(&pos_req)?;
    let client = first_running_client(&state, &pos_req).await?;
    let params = RenameParams {
        text_document_position: pos,
        new_name: req.new_name,
        work_done_progress_params: WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::rename(client, params).await.map_err(map_lsp)?;
    Ok(res.0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormattingReq {
    pub path: String,
    #[serde(default)]
    pub server_id: Option<String>,
    pub tab_size: u32,
    pub insert_spaces: bool,
}

fn formatting_options(req: &FormattingReq) -> FormattingOptions {
    FormattingOptions {
        tab_size: req.tab_size,
        insert_spaces: req.insert_spaces,
        ..Default::default()
    }
}

fn path_to_uri(path: &str) -> AppResult<Uri> {
    use std::str::FromStr;
    let url = url::Url::from_file_path(PathBuf::from(path))
        .map_err(|()| AppError::Internal(format!("bad path: {path}")))?;
    Uri::from_str(url.as_str()).map_err(|e| AppError::Internal(format!("bad uri: {e}")))
}

#[tauri::command]
pub async fn lsp_formatting(
    state: State<'_, AppState>,
    req: FormattingReq,
) -> AppResult<Vec<TextEdit>> {
    let uri = path_to_uri(&req.path)?;
    let pos_req = PositionReq {
        path: req.path.clone(),
        line: 0,
        character: 0,
        server_id: req.server_id.clone(),
    };
    let client = first_running_client(&state, &pos_req).await?;
    let params = DocumentFormattingParams {
        text_document: TextDocumentIdentifier { uri },
        options: formatting_options(&req),
        work_done_progress_params: WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::formatting(client, params)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeFormattingReq {
    pub path: String,
    #[serde(default)]
    pub server_id: Option<String>,
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
    pub tab_size: u32,
    pub insert_spaces: bool,
}

#[tauri::command]
pub async fn lsp_range_formatting(
    state: State<'_, AppState>,
    req: RangeFormattingReq,
) -> AppResult<Vec<TextEdit>> {
    let uri = path_to_uri(&req.path)?;
    let pos_req = PositionReq {
        path: req.path.clone(),
        line: 0,
        character: 0,
        server_id: req.server_id.clone(),
    };
    let client = first_running_client(&state, &pos_req).await?;
    let params = DocumentRangeFormattingParams {
        text_document: TextDocumentIdentifier { uri },
        range: Range {
            start: Position::new(req.start_line, req.start_character),
            end: Position::new(req.end_line, req.end_character),
        },
        options: FormattingOptions {
            tab_size: req.tab_size,
            insert_spaces: req.insert_spaces,
            ..Default::default()
        },
        work_done_progress_params: WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::range_formatting(client, params)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

// === M4.3 advanced commands ===

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlayHintReq {
    pub path: String,
    #[serde(default)]
    pub server_id: Option<String>,
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
}

#[tauri::command]
pub async fn lsp_inlay_hint(
    state: State<'_, AppState>,
    req: InlayHintReq,
) -> AppResult<Vec<InlayHint>> {
    let uri = path_to_uri(&req.path)?;
    let pos_req = PositionReq {
        path: req.path.clone(),
        line: 0,
        character: 0,
        server_id: req.server_id.clone(),
    };
    let client = first_running_client(&state, &pos_req).await?;
    let params = InlayHintParams {
        text_document: TextDocumentIdentifier { uri },
        range: Range {
            start: Position::new(req.start_line, req.start_character),
            end: Position::new(req.end_line, req.end_character),
        },
        work_done_progress_params: WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::inlay_hint(client, params)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlayHintResolveReq {
    pub server_id: String,
    pub hint: InlayHint,
}

#[tauri::command]
pub async fn lsp_inlay_hint_resolve(
    state: State<'_, AppState>,
    req: InlayHintResolveReq,
) -> AppResult<Option<InlayHint>> {
    let client = state
        .lsp_manager
        .client_by_id(&req.server_id)
        .await
        .ok_or_else(|| AppError::Internal(format!("no client for {}", req.server_id)))?;
    let (res, _) = requests::inlay_hint_resolve(client, req.hint)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

#[tauri::command]
pub async fn lsp_semantic_tokens(
    state: State<'_, AppState>,
    req: PositionReq,
) -> AppResult<Option<SemanticTokensResult>> {
    let uri = path_to_uri(&req.path)?;
    let client = first_running_client(&state, &req).await?;
    let params = SemanticTokensParams {
        text_document: TextDocumentIdentifier { uri },
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    };
    let (res, _) = requests::semantic_tokens_full(client, params)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeActionReq {
    pub path: String,
    #[serde(default)]
    pub server_id: Option<String>,
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
    #[serde(default)]
    pub diagnostics: Vec<lsp_types::Diagnostic>,
}

#[tauri::command]
pub async fn lsp_code_action(
    state: State<'_, AppState>,
    req: CodeActionReq,
) -> AppResult<Vec<CodeActionOrCommand>> {
    let uri = path_to_uri(&req.path)?;
    let pos_req = PositionReq {
        path: req.path.clone(),
        line: 0,
        character: 0,
        server_id: req.server_id.clone(),
    };
    let client = first_running_client(&state, &pos_req).await?;
    let params = CodeActionParams {
        text_document: TextDocumentIdentifier { uri },
        range: Range {
            start: Position::new(req.start_line, req.start_character),
            end: Position::new(req.end_line, req.end_character),
        },
        context: CodeActionContext {
            diagnostics: req.diagnostics,
            only: None,
            trigger_kind: None,
        },
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    };
    let (res, _) = requests::code_action(client, params)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeActionResolveReq {
    pub server_id: String,
    pub action: CodeAction,
}

#[tauri::command]
pub async fn lsp_code_action_resolve(
    state: State<'_, AppState>,
    req: CodeActionResolveReq,
) -> AppResult<Option<CodeAction>> {
    let client = state
        .lsp_manager
        .client_by_id(&req.server_id)
        .await
        .ok_or_else(|| AppError::Internal(format!("no client for {}", req.server_id)))?;
    let (res, _) = requests::code_action_resolve(client, req.action)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteCommandReq {
    pub server_id: String,
    pub command: String,
    #[serde(default)]
    pub arguments: Vec<Value>,
}

#[tauri::command]
pub async fn lsp_execute_command(
    state: State<'_, AppState>,
    req: ExecuteCommandReq,
) -> AppResult<Option<Value>> {
    let client = state
        .lsp_manager
        .client_by_id(&req.server_id)
        .await
        .ok_or_else(|| AppError::Internal(format!("no client for {}", req.server_id)))?;
    let params = ExecuteCommandParams {
        command: req.command,
        arguments: req.arguments,
        work_done_progress_params: WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::execute_command(client, params)
        .await
        .map_err(map_lsp)?;
    Ok(res.0)
}
