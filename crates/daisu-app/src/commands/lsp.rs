//! Tauri command bridge for `daisu-lsp`. M4.0 ships trust gate +
//! status query; spawning lives in M4.1.

#![allow(
    clippy::needless_pass_by_value,
    clippy::missing_errors_doc,
    clippy::unused_async
)]

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use daisu_lsp::{trust, ServerStatus};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

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
    state: State<'_, AppState>,
    req: WorkspacePath,
) -> AppResult<TrustState> {
    let p = PathBuf::from(&req.workspace_path);
    trust::grant(&p).map_err(map_lsp)?;
    // Once trusted, eagerly load config so the UI can immediately show
    // server statuses. Config path defaults to ~/.daisu/lsp.toml when
    // it exists, falling back to defaults.
    let config_path = home_lsp_config_path();
    state
        .lsp_manager
        .open_workspace(p, &config_path)
        .await
        .map_err(map_lsp)?;
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

fn home_lsp_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".daisu")
        .join("lsp.toml")
}
