#![allow(dead_code)]
//! Test helpers for spawning the `fake_lsp` binary with canned responses.
//!
//! Cargo sets `CARGO_BIN_EXE_fake_lsp` to the absolute path of the built
//! binary when running integration tests, so this module resolves it
//! deterministically without invoking `cargo run`.
//!
//! Configuration is delivered via a per-spawn temp JSON file so parallel
//! tests don't collide.

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
    pub log: bool,
}

impl MockOpts {
    pub fn new() -> Self {
        Self {
            responses: json!({}),
            init_capabilities: None,
            log: false,
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

    pub fn with_log(mut self, log: bool) -> Self {
        self.log = log;
        self
    }
}

/// Spawn a `Client` connected to a fresh `fake_lsp` process configured
/// with the supplied canned responses. The client is fully initialized
/// (handshake completed) and ready to handle request methods.
pub async fn spawn_mock_client(opts: MockOpts) -> Client {
    let bin = fake_lsp_path();
    let bin_str = bin.to_string_lossy().to_string();

    let mut config = serde_json::Map::new();
    config.insert("responses".into(), opts.responses);
    if let Some(caps) = opts.init_capabilities {
        config.insert("capabilities".into(), caps);
    }
    if opts.log {
        config.insert("log".into(), json!(true));
    }

    // Per-spawn temp file avoids env-var races between parallel tests.
    let tmp = tempfile::NamedTempFile::new().expect("temp config");
    serde_json::to_writer(tmp.as_file(), &Value::Object(config)).expect("write config");
    let (_file, path) = tmp.keep().expect("persist temp config");
    let config_arg = path.to_string_lossy().to_string();

    let workspace = tempfile::tempdir().expect("tempdir");
    let diags = Arc::new(DiagnosticsCache::default());
    Client::spawn(
        "fake-lsp".into(),
        &bin_str,
        &["--config".into(), config_arg],
        workspace.path(),
        diags,
    )
    .await
    .expect("Client::spawn fake_lsp")
}
