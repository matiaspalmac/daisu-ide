#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

use daisu_app::{commands, AppState};
use tauri::{Emitter, Manager, WebviewWindow};

const DROPPED_PATH_EVENT: &str = "system:dropped-path";

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
            commands::webview::detect_webview2
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                wire_drag_drop(&window, app.handle().clone());
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
