//! Discord Rich Presence integration.
//!
//! Wraps `discord-rich-presence` behind Tauri commands so the UI can
//! advertise the current editing context (project + active file). The IPC
//! client lives in a process-global mutex; reconnect attempts are best-effort
//! — if Discord is closed, calls fail silently.

#![allow(clippy::missing_errors_doc, clippy::needless_pass_by_value)]

use std::sync::Mutex;

use discord_rich_presence::{
    activity::{Activity, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use serde::Deserialize;

use crate::error::{AppError, AppResult};

static CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPayload {
    pub details: Option<String>,
    pub state: Option<String>,
    pub start_timestamp: Option<i64>,
    pub large_image: Option<String>,
    pub large_text: Option<String>,
    pub small_image: Option<String>,
    pub small_text: Option<String>,
}

fn map_err<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Internal(format!("discord rpc: {e}"))
}

#[tauri::command]
pub async fn discord_connect(app_id: String) -> AppResult<()> {
    // Move the entire blocking IPC handshake off the Tauri command thread.
    // `connect()` performs synchronous socket calls which can stall the UI
    // thread when Discord is slow to respond or unavailable, freezing the
    // window until they time out.
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let mut guard = CLIENT
            .lock()
            .map_err(|_| AppError::Internal("discord rpc mutex poisoned".into()))?;
        // Re-creating the client is cheap; drop the old one first so a stale
        // socket doesn't linger after Discord restarts.
        if let Some(mut old) = guard.take() {
            let _ = old.close();
        }
        let mut client = DiscordIpcClient::new(&app_id).map_err(map_err)?;
        client.connect().map_err(map_err)?;
        *guard = Some(client);
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(format!("discord rpc join: {e}")))?
}

#[tauri::command]
pub async fn discord_set_activity(payload: ActivityPayload) -> AppResult<()> {
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let mut guard = CLIENT
            .lock()
            .map_err(|_| AppError::Internal("discord rpc mutex poisoned".into()))?;
        let Some(client) = guard.as_mut() else {
            return Err(AppError::Internal("discord rpc not connected".into()));
        };

        let mut activity = Activity::new();
        if let Some(d) = payload.details.as_deref() {
            activity = activity.details(d);
        }
        if let Some(s) = payload.state.as_deref() {
            activity = activity.state(s);
        }
        if let Some(ts) = payload.start_timestamp {
            activity = activity.timestamps(Timestamps::new().start(ts));
        }
        let mut assets = Assets::new();
        let mut have_assets = false;
        if let Some(li) = payload.large_image.as_deref() {
            assets = assets.large_image(li);
            have_assets = true;
        }
        if let Some(lt) = payload.large_text.as_deref() {
            assets = assets.large_text(lt);
            have_assets = true;
        }
        if let Some(si) = payload.small_image.as_deref() {
            assets = assets.small_image(si);
            have_assets = true;
        }
        if let Some(st) = payload.small_text.as_deref() {
            assets = assets.small_text(st);
            have_assets = true;
        }
        if have_assets {
            activity = activity.assets(assets);
        }

        client.set_activity(activity).map_err(map_err)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(format!("discord rpc join: {e}")))?
}

#[tauri::command]
pub async fn discord_clear_activity() -> AppResult<()> {
    tokio::task::spawn_blocking(|| -> AppResult<()> {
        let mut guard = CLIENT
            .lock()
            .map_err(|_| AppError::Internal("discord rpc mutex poisoned".into()))?;
        if let Some(client) = guard.as_mut() {
            client.clear_activity().map_err(map_err)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(format!("discord rpc join: {e}")))?
}

#[tauri::command]
pub async fn discord_disconnect() -> AppResult<()> {
    tokio::task::spawn_blocking(|| -> AppResult<()> {
        let mut guard = CLIENT
            .lock()
            .map_err(|_| AppError::Internal("discord rpc mutex poisoned".into()))?;
        if let Some(mut client) = guard.take() {
            let _ = client.close();
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(format!("discord rpc join: {e}")))?
}
