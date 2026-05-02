//! Settings export/import. The frontend owns the schema (Zod);
//! this module is byte-level I/O only.
//!
//! Atomic export: copy via tmp + rename. NTFS rename is atomic on the same
//! volume, so a partial overwrite cannot leave a half-written exported file.

use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::error::{AppError, AppResult};

const STORE_FILENAME: &str = "settings.json";

/// Resolve the absolute path of the `tauri-plugin-store` settings file.
///
/// # Errors
/// Returns [`AppError::Internal`] if `app_data_dir()` fails.
pub fn settings_store_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("resolve app_data_dir: {e}")))?;
    Ok(dir.join(STORE_FILENAME))
}

/// Pure helper: copy the settings store at `store_file` to `target_path`
/// atomically (tmp + rename).
///
/// # Errors
/// Returns [`AppError::IoError`] on any FS failure.
pub async fn export_settings_at(store_file: &Path, target_path: &Path) -> AppResult<()> {
    let bytes = tokio::fs::read(store_file).await?;

    let parent = target_path.parent().unwrap_or_else(|| Path::new("."));
    tokio::fs::create_dir_all(parent).await?;

    let tmp = parent.join(format!(
        ".{}.tmp",
        target_path.file_name().map_or_else(
            || "exported.json".to_string(),
            |s| s.to_string_lossy().into_owned()
        )
    ));
    tokio::fs::write(&tmp, &bytes).await?;
    tokio::fs::rename(&tmp, target_path).await?;
    Ok(())
}

/// Pure helper: read a settings JSON file from `source_path` and return raw
/// JSON for the frontend to validate.
///
/// # Errors
/// Returns [`AppError::IoError`] if missing/unreadable; [`AppError::Internal`]
/// if not valid JSON.
pub async fn import_settings_at(source_path: &Path) -> AppResult<serde_json::Value> {
    let bytes = tokio::fs::read(source_path).await?;
    serde_json::from_slice::<serde_json::Value>(&bytes)
        .map_err(|e| AppError::Internal(format!("parse settings json: {e}")))
}

/// Tauri command: export the active settings store to `target_path`.
///
/// # Errors
/// Propagates errors from [`export_settings_at`].
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub async fn export_settings(app: tauri::AppHandle, target_path: String) -> AppResult<()> {
    let store_file = settings_store_path(&app)?;
    export_settings_at(&store_file, Path::new(&target_path)).await
}

/// Tauri command: read settings JSON from `source_path` and return raw JSON.
///
/// # Errors
/// Propagates errors from [`import_settings_at`].
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub async fn import_settings(source_path: String) -> AppResult<serde_json::Value> {
    import_settings_at(Path::new(&source_path)).await
}
