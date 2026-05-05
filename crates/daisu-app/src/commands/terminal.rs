//! Tauri command bridge for `daisu-term`. Spawns shells, pipes I/O
//! to/from the frontend xterm.js, and emits per-session output events.

#![allow(
    clippy::needless_pass_by_value,
    clippy::missing_errors_doc,
    clippy::unused_async
)]

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

use daisu_term::{TermError, TermSpawnOpts};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

const OUTPUT_EVENT_PREFIX: &str = "terminal://output:";
const EXIT_EVENT_PREFIX: &str = "terminal://exit:";

fn map_term(e: TermError) -> AppError {
    AppError::Internal(format!("term: {e}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermSpawnReq {
    pub cwd: String,
    #[serde(default)]
    pub shell: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermSpawnRes {
    pub id: String,
}

#[tauri::command]
pub async fn terminal_spawn(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: TermSpawnReq,
) -> AppResult<TermSpawnRes> {
    let id = state
        .term_manager
        .spawn(TermSpawnOpts {
            cwd: req.cwd,
            shell: req.shell,
            cols: req.cols,
            rows: req.rows,
        })
        .map_err(map_term)?;
    let mut sub = state.term_manager.subscribe(&id).map_err(map_term)?;
    let event_name = format!("{OUTPUT_EVENT_PREFIX}{id}");
    let exit_name = format!("{EXIT_EVENT_PREFIX}{id}");
    let app_for_task = app.clone();
    tokio::spawn(async move {
        let engine = base64::engine::general_purpose::STANDARD;
        loop {
            match sub.recv().await {
                Ok(bytes) => {
                    let payload = engine.encode(&bytes);
                    let _ = app_for_task.emit(&event_name, payload);
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
            }
        }
        let _ = app_for_task.emit(&exit_name, ());
    });
    Ok(TermSpawnRes { id })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermWriteReq {
    pub id: String,
    pub data: String,
}

#[tauri::command]
pub async fn terminal_write(state: State<'_, AppState>, req: TermWriteReq) -> AppResult<()> {
    let engine = base64::engine::general_purpose::STANDARD;
    let bytes = engine
        .decode(req.data.as_bytes())
        .map_err(|e| AppError::Internal(format!("base64: {e}")))?;
    state.term_manager.write(&req.id, &bytes).map_err(map_term)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermResizeReq {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub async fn terminal_resize(state: State<'_, AppState>, req: TermResizeReq) -> AppResult<()> {
    state
        .term_manager
        .resize(&req.id, req.cols, req.rows)
        .map_err(map_term)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermKillReq {
    pub id: String,
}

#[tauri::command]
pub async fn terminal_kill(state: State<'_, AppState>, req: TermKillReq) -> AppResult<()> {
    state.term_manager.kill(&req.id).map_err(map_term)
}

#[tauri::command]
pub async fn terminal_list(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    Ok(state.term_manager.list())
}
