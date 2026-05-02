//! Workspace lifecycle commands: open, close.
//!
//! `open_workspace` cancels any prior walker, spawns a new walker + watchers,
//! and emits batches over `workspace:tree-batch`. The frontend correlates
//! batches via `batch_id` so stale batches from a cancelled walk are ignored.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::watch::workspace::{spawn_workspace_watcher, walk_workspace, WalkOptions};

const TREE_BATCH_EVENT: &str = "workspace:tree-batch";
const FS_CHANGED_EVENT: &str = "workspace:fs-changed";
const GIT_INDEX_EVENT: &str = "workspace:git-index";

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceInfo {
    pub root_path: String,
    pub batch_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct FsChangedPayload {
    paths: Vec<String>,
}

/// Open `path` as the active workspace.
///
/// Cancels any prior walker token, validates `path`, stores the new root and
/// token in [`AppState`], then spawns the walker + watchers. Returns
/// immediately with `WorkspaceInfo { root_path, batch_id }`; nodes arrive
/// asynchronously over `workspace:tree-batch`.
///
/// # Errors
/// - [`AppError::NotFound`] if `path` does not exist
/// - [`AppError::IoError`] if `path` is not a directory
/// - [`AppError::WatcherError`] if the watcher fails to start
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn open_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<WorkspaceInfo> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(AppError::not_found(path));
    }
    if !root.is_dir() {
        return Err(AppError::IoError {
            kind: "NotADirectory".into(),
            message: format!("not a directory: {path}"),
        });
    }

    if let Some(prev) = state.take_walker_token() {
        prev.cancel();
    }
    let token = CancellationToken::new();
    let _ = state.replace_walker_token(token.clone());
    state.set_root(Some(root.clone()));

    let batch_id = generate_batch_id();
    let batch_id_walker = batch_id.clone();

    let (batch_tx, mut batch_rx) = mpsc::channel::<crate::watch::workspace::TreeBatch>(16);
    let app_for_batches = app.clone();
    tokio::spawn(async move {
        while let Some(batch) = batch_rx.recv().await {
            let _ = app_for_batches.emit(TREE_BATCH_EVENT, &batch);
        }
    });

    let token_for_walker = token.clone();
    let root_for_walker = root.clone();
    tokio::spawn(async move {
        if let Err(e) = walk_workspace(
            root_for_walker,
            WalkOptions::default(),
            batch_id_walker,
            token_for_walker,
            batch_tx,
        )
        .await
        {
            eprintln!("daisu walker exited: {e:?}");
        }
    });

    let (fs_tx, mut fs_rx) = mpsc::channel::<Vec<String>>(64);
    let (git_tx, mut git_rx) = mpsc::channel::<()>(8);
    let watch_handle = spawn_workspace_watcher(
        root.clone(),
        fs_tx,
        git_tx,
        token.clone(),
        Duration::from_millis(200),
    )?;
    tokio::spawn(async move {
        let _hold = watch_handle;
        token.cancelled().await;
    });

    let app_for_fs = app.clone();
    tokio::spawn(async move {
        while let Some(paths) = fs_rx.recv().await {
            let _ = app_for_fs.emit(FS_CHANGED_EVENT, FsChangedPayload { paths });
        }
    });
    let app_for_git = app.clone();
    tokio::spawn(async move {
        while git_rx.recv().await.is_some() {
            let _ = app_for_git.emit(GIT_INDEX_EVENT, ());
        }
    });

    Ok(WorkspaceInfo {
        root_path: root.display().to_string(),
        batch_id,
    })
}

/// Cancel the active walker and watchers; clear the workspace root.
///
/// # Errors
/// Currently never errors; signature returns `AppResult` so future
/// teardown work (Phase 5+) can surface failures.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn close_workspace(state: State<'_, AppState>) -> AppResult<()> {
    if let Some(prev) = state.take_walker_token() {
        prev.cancel();
    }
    state.set_root(None);
    Ok(())
}

fn generate_batch_id() -> String {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    format!("walk-{nanos}")
}
