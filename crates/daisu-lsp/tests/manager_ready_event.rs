//! Integration test that LspManager emits `ServerReadyEvent` when a
//! configured server completes its initialize handshake. Uses the
//! `fake_lsp` mock binary as the spawned server.

mod common;

use std::path::PathBuf;
use std::time::Duration;

use daisu_lsp::config::{LspConfig, ServerConfig};
use daisu_lsp::LspManager;

#[tokio::test]
async fn manager_emits_server_ready_after_open_document() {
    let bin = common::fake_lsp_path();
    let bin_str = bin.to_string_lossy().to_string();

    // Custom config: one fake server that handles `rust` files.
    let config = LspConfig {
        servers: vec![ServerConfig {
            id: "fake".into(),
            command: bin_str,
            args: vec![],
            languages: vec!["rust".into()],
            initialization_options: None,
        }],
    };

    let workspace = tempfile::tempdir().expect("tempdir");
    let config_path = workspace.path().join("lsp.toml");
    config.save(&config_path).expect("save config");

    let mgr = LspManager::new();
    let mut rx = mgr.subscribe_ready();
    mgr.open_workspace(workspace.path().to_path_buf(), &config_path)
        .await
        .expect("open_workspace");

    // Trigger lazy spawn: open a Rust document.
    let doc_path = workspace.path().join("main.rs");
    std::fs::write(&doc_path, "fn main() {}\n").expect("write doc");
    mgr.open_document(&doc_path, "fn main() {}\n".into())
        .await
        .expect("open_document");

    // Await the ready event with a generous timeout — the handshake
    // includes spawning a child process and an initialize round-trip.
    let ev = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("ready event timeout")
        .expect("ready event channel closed");

    assert_eq!(ev.server_id, "fake");
    assert_eq!(ev.languages, vec!["rust".to_string()]);
    assert!(ev.capabilities.definition);
    assert!(ev.capabilities.references);
    assert!(ev.capabilities.document_symbol);
    assert!(ev.capabilities.workspace_symbol);
}

// Surface unused imports so the standalone PathBuf import doesn't trigger
// dead-code warnings if the helper changes shape.
#[allow(dead_code)]
fn _path_assertion(_p: PathBuf) {}
