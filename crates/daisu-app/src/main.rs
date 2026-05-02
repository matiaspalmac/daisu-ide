#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use daisu_app::commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![commands::webview_stub::ping])
        .run(tauri::generate_context!())
        .expect("error while running daisu app");
}
