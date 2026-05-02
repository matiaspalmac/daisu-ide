//! Per-workspace session blob persistence.
//!
//! The frontend owns the schema; this module reads/writes opaque JSON. Atomic
//! write protocol: write to `session.json.tmp`, then rename to `session.json`.
//! NTFS rename is atomic on the same volume so a partial overwrite cannot
//! produce a half-written `session.json`. We do not call `fsync` after the
//! write, so a hard crash within the OS write-back window may discard the
//! new bytes; the previously committed file remains intact in that case.

use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::error::{AppError, AppResult};

const SESSIONS_SUBDIR: &str = "sessions";
const SESSION_FILE: &str = "session.json";
const TMP_FILE: &str = "session.json.tmp";

fn workspace_dir(sessions_root: &Path, workspace_hash: &str) -> PathBuf {
    sessions_root.join(workspace_hash)
}

/// Save the session blob for `workspace_hash` under `sessions_root`.
///
/// Creates the workspace subdir if missing. Atomic via tmp + rename.
///
/// # Errors
/// Returns [`AppError::IoError`] on any FS failure.
pub async fn save_session_at(
    sessions_root: &Path,
    workspace_hash: &str,
    blob: &serde_json::Value,
) -> AppResult<()> {
    let dir = workspace_dir(sessions_root, workspace_hash);
    tokio::fs::create_dir_all(&dir).await?;

    let tmp = dir.join(TMP_FILE);
    let final_path = dir.join(SESSION_FILE);

    let bytes = serde_json::to_vec_pretty(blob)
        .map_err(|e| AppError::Internal(format!("serialize session: {e}")))?;

    tokio::fs::write(&tmp, &bytes).await?;
    tokio::fs::rename(&tmp, &final_path).await?;
    Ok(())
}

/// Load the session blob for `workspace_hash` under `sessions_root`.
///
/// Returns `Ok(None)` when the file is missing or malformed; never errors on
/// a clean "no-session" path.
///
/// # Errors
/// Returns [`AppError::IoError`] only for unexpected FS failures (the file
/// existing but unreadable due to permissions, for example).
pub async fn load_session_at(
    sessions_root: &Path,
    workspace_hash: &str,
) -> AppResult<Option<serde_json::Value>> {
    let path = workspace_dir(sessions_root, workspace_hash).join(SESSION_FILE);
    match tokio::fs::read(&path).await {
        Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(value) => Ok(Some(value)),
            Err(_) => Ok(None),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Delete the session blob for `workspace_hash`. Idempotent.
///
/// # Errors
/// Returns [`AppError::IoError`] on unexpected FS failure (not for missing
/// files).
pub async fn delete_session_at(sessions_root: &Path, workspace_hash: &str) -> AppResult<()> {
    let path = workspace_dir(sessions_root, workspace_hash).join(SESSION_FILE);
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

fn sessions_root(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("resolve app_data_dir: {e}")))?;
    Ok(base.join(SESSIONS_SUBDIR))
}

/// Tauri command form of [`save_session_at`].
///
/// # Errors
/// Propagates errors from [`save_session_at`].
#[tauri::command]
pub async fn save_session(
    app: tauri::AppHandle,
    workspace_hash: String,
    blob: serde_json::Value,
) -> AppResult<()> {
    let root = sessions_root(&app)?;
    save_session_at(&root, &workspace_hash, &blob).await
}

/// Tauri command form of [`load_session_at`].
///
/// # Errors
/// Propagates errors from [`load_session_at`].
#[tauri::command]
pub async fn load_session(
    app: tauri::AppHandle,
    workspace_hash: String,
) -> AppResult<Option<serde_json::Value>> {
    let root = sessions_root(&app)?;
    load_session_at(&root, &workspace_hash).await
}

/// Tauri command form of [`delete_session_at`].
///
/// # Errors
/// Propagates errors from [`delete_session_at`].
#[tauri::command]
pub async fn delete_session(app: tauri::AppHandle, workspace_hash: String) -> AppResult<()> {
    let root = sessions_root(&app)?;
    delete_session_at(&root, &workspace_hash).await
}
