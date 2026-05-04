#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

use daisu_app::{commands, AppState};
use tauri::{Emitter, Manager, WebviewWindow};

const DROPPED_PATH_EVENT: &str = "system:dropped-path";
const BEFORE_CLOSE_EVENT: &str = "system:before-close";

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::file_ops::open_file,
            commands::file_ops::save_file,
            commands::file_ops::list_dir,
            commands::file_ops::create_file,
            commands::file_ops::create_dir,
            commands::file_ops::rename_path,
            commands::file_ops::delete_to_trash,
            commands::file_ops::restore_from_trash,
            commands::file_ops::copy_path,
            commands::workspace::open_workspace,
            commands::workspace::close_workspace,
            commands::session::save_session,
            commands::session::load_session,
            commands::session::delete_session,
            commands::themes::list_bundled_themes,
            commands::themes::read_theme_json,
            commands::settings::export_settings,
            commands::settings::import_settings,
            commands::file_ops::convert_eol,
            commands::file_ops::read_file_with_encoding,
            commands::search::search_workspace,
            commands::search::cancel_search,
            commands::search::replace_in_workspace,
            commands::git::git_workspace_info,
            commands::git::git_list_branches,
            commands::git::git_checkout_branch,
            commands::git::git_fetch_remote,
            commands::webview::detect_webview2,
            commands::discord::discord_connect,
            commands::discord::discord_set_activity,
            commands::discord::discord_clear_activity,
            commands::discord::discord_disconnect,
            commands::agent::agent_provider_list,
            commands::agent::agent_key_set,
            commands::agent::agent_key_clear,
            commands::agent::agent_key_has,
            commands::agent::agent_provider_test,
            commands::agent::agent_create_conversation,
            commands::agent::agent_list_conversations,
            commands::agent::agent_get_messages,
            commands::agent::agent_delete_conversation,
            commands::agent::agent_send_message,
            commands::agent::agent_cancel,
            commands::agent::agent_tool_list,
            commands::agent::agent_tool_dispatch,
            commands::agent::agent_permission_resolve,
            commands::agent::agent_permission_list_allowlist,
            commands::agent::agent_permission_clear_allowlist,
            commands::agent::agent_index_rebuild,
            commands::agent::agent_index_search,
            commands::agent::agent_index_status,
            commands::agent::agent_mcp_connect,
            commands::agent::agent_mcp_disconnect,
            commands::agent::agent_mcp_status,
            commands::agent::agent_mcp_list_tools,
            commands::agent::agent_mcp_call_tool
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                wire_drag_drop(&window, app.handle().clone());
                wire_before_close(&window, app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running daisu app");
}

fn wire_drag_drop(window: &WebviewWindow, handle: tauri::AppHandle) {
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
            if let Some(first) = paths.first() {
                let path: PathBuf = first.clone();
                let _ = handle.emit(DROPPED_PATH_EVENT, path.display().to_string());
            }
        }
    });
}

fn wire_before_close(window: &WebviewWindow, handle: tauri::AppHandle) {
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
            let _ = handle.emit(BEFORE_CLOSE_EVENT, ());
        }
    });
}
