#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use daisu_app::{commands, AppState};

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
            commands::webview::detect_webview2
        ])
        .run(tauri::generate_context!())
        .expect("error while running daisu app");
}
