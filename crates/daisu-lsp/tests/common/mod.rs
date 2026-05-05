#![allow(dead_code)]
//! Test helpers for spawning the `fake_lsp` binary with canned responses.
//!
//! Cargo sets `CARGO_BIN_EXE_fake_lsp` to the absolute path of the built
//! binary when running integration tests, so this module resolves it
//! deterministically without invoking `cargo run`.

use std::path::PathBuf;
use std::sync::Arc;

use daisu_lsp::client::Client;
use daisu_lsp::diagnostics::DiagnosticsCache;
use serde_json::{json, Value};

/// Path to the `fake_lsp` binary built by Cargo. Available because
/// `crates/daisu-lsp/src/bin/fake_lsp.rs` exists.
pub fn fake_lsp_path() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_fake_lsp"))
}

pub struct MockOpts {
    pub responses: Value,
    pub init_capabilities: Option<Value>,
}

impl MockOpts {
    pub fn new() -> Self {
        Self {
            responses: json!({}),
            init_capabilities: None,
        }
    }

    pub fn with_response(mut self, method: &str, result: Value) -> Self {
        let map = self.responses.as_object_mut().expect("responses is object");
        map.insert(method.to_string(), result);
        self
    }

    pub fn with_init_capabilities(mut self, caps: Value) -> Self {
        self.init_capabilities = Some(caps);
        self
    }
}

/// Spawn a `Client` connected to a fresh `fake_lsp` process configured
/// with the supplied canned responses. The client is fully initialized
/// (handshake completed) and ready to handle request methods.
pub async fn spawn_mock_client(opts: MockOpts) -> Client {
    let bin = fake_lsp_path();
    let bin_str = bin.to_string_lossy().to_string();

    // We need to set env vars *before* the child spawns. `Transport::spawn`
    // does not currently expose env-var injection, so we set them on the
    // current process; tokio::process::Command inherits by default. Each
    // test owns its env via `std::env::set_var` — tests must NOT run in
    // parallel against shared keys. The integration test binary uses
    // `#[tokio::test(flavor = "current_thread")]` to keep mutations
    // serialized within a test, but tests must serialize externally via
    // a global mutex or `cargo test -- --test-threads=1` for safety.
    std::env::set_var("FAKE_LSP_RESPONSES", opts.responses.to_string());
    if let Some(caps) = opts.init_capabilities {
        std::env::set_var("FAKE_LSP_INIT_CAPABILITIES", caps.to_string());
    } else {
        std::env::remove_var("FAKE_LSP_INIT_CAPABILITIES");
    }

    let workspace = tempfile::tempdir().expect("tempdir");
    let diags = Arc::new(DiagnosticsCache::default());
    Client::spawn("fake-lsp".into(), &bin_str, &[], workspace.path(), diags)
        .await
        .expect("Client::spawn fake_lsp")
}
