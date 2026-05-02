//! Bundled theme registry. Phase 4 ships two MIT-derived themes
//! (`daisu-dark`, `daisu-light`) embedded via `include_str!`. Custom imports
//! and watcher-driven hot reload are deferred to M2.

use serde::Serialize;

use crate::error::{AppError, AppResult};

const BUNDLED_DARK: &str = include_str!("../themes/daisu-dark.json");
const BUNDLED_LIGHT: &str = include_str!("../themes/daisu-light.json");

/// Descriptor returned to the frontend so the picker can render swatches and
/// filter by kind without reading the full JSON for every entry.
#[derive(Debug, Clone, Serialize)]
pub struct ThemeDescriptor {
    pub id: String,
    pub name: String,
    /// `"dark"` or `"light"`. High-contrast variants are not bundled in M1.
    pub kind: String,
}

/// Inner pure function for testing.
#[must_use]
pub fn list_bundled_themes_inner() -> Vec<ThemeDescriptor> {
    vec![
        ThemeDescriptor {
            id: "daisu-dark".to_string(),
            name: "Daisu Dark".to_string(),
            kind: "dark".to_string(),
        },
        ThemeDescriptor {
            id: "daisu-light".to_string(),
            name: "Daisu Light".to_string(),
            kind: "light".to_string(),
        },
    ]
}

/// Inner pure function for testing.
///
/// # Errors
/// Returns [`AppError::NotFound`] for unknown ids; [`AppError::Internal`] if
/// the bundled JSON fails to parse (build-time issue, not user-facing).
pub fn read_theme_json_inner(id: &str) -> AppResult<serde_json::Value> {
    let raw = match id {
        "daisu-dark" => BUNDLED_DARK,
        "daisu-light" => BUNDLED_LIGHT,
        _ => return Err(AppError::not_found(id)),
    };
    serde_json::from_str(raw)
        .map_err(|e| AppError::Internal(format!("parse bundled theme {id}: {e}")))
}

/// Tauri command: list bundled theme descriptors.
///
/// # Errors
/// Currently infallible (kept `AppResult` for symmetry with other commands).
#[tauri::command]
#[allow(clippy::unnecessary_wraps)]
pub fn list_bundled_themes() -> AppResult<Vec<ThemeDescriptor>> {
    Ok(list_bundled_themes_inner())
}

/// Tauri command: read the bundled theme JSON for `id`.
///
/// # Errors
/// Propagates errors from [`read_theme_json_inner`].
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn read_theme_json(id: String) -> AppResult<serde_json::Value> {
    read_theme_json_inner(&id)
}
