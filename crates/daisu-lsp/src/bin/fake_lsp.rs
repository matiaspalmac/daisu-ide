//! Test-only LSP server stub. Reads canned responses from env vars and
//! replies to incoming JSON-RPC requests with the matching JSON, framed
//! using LSP Content-Length headers.
//!
//! Env vars consumed:
//!   `FAKE_LSP_INIT_CAPABILITIES` — JSON object spliced into `initialize`
//!     response under `capabilities`. Defaults to all four nav providers
//!     advertised so navigation tests don't need to set it explicitly.
//!   `FAKE_LSP_RESPONSES` — JSON object mapping `<method>` to either
//!     a JSON value (used as `result`) or an object
//!     `{ "result": <value> }` / `{ "error": { "code": N, "message": "" } }`.
//!   `FAKE_LSP_LOG` — if set to "1", server writes each incoming method
//!     line-buffered to stderr (helpful when debugging tests).
//!
//! The binary is built automatically by Cargo because it lives at
//! `src/bin/fake_lsp.rs`. Integration tests resolve the executable via
//! the `CARGO_BIN_EXE_fake_lsp` env var that Cargo sets during test runs.

use std::io::{self};

use serde_json::{json, Value};
use tokio::io::{AsyncWriteExt, BufReader};

#[tokio::main(flavor = "current_thread")]
async fn main() -> io::Result<()> {
    let log_enabled = std::env::var("FAKE_LSP_LOG").ok().as_deref() == Some("1");
    let init_caps: Value = std::env::var("FAKE_LSP_INIT_CAPABILITIES")
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(default_capabilities);
    let canned: Value = std::env::var("FAKE_LSP_RESPONSES")
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}));

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut stdout = tokio::io::stdout();

    loop {
        let frame = match daisu_lsp::framing::read_frame(&mut reader).await {
            Ok(Some(b)) => b,
            Ok(None) => break,
            Err(e) => {
                if log_enabled {
                    eprintln!("[fake_lsp] read error: {e}");
                }
                break;
            }
        };
        let msg: Value = match serde_json::from_slice(&frame) {
            Ok(v) => v,
            Err(e) => {
                if log_enabled {
                    eprintln!("[fake_lsp] parse error: {e}");
                }
                continue;
            }
        };
        if log_enabled {
            eprintln!("[fake_lsp] <- {}", msg);
        }

        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let id = msg.get("id").cloned();

        // Notifications carry no id; nothing to reply.
        if id.is_none() {
            if method == "exit" {
                break;
            }
            continue;
        }

        let response_body = if method == "initialize" {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "capabilities": init_caps,
                    "serverInfo": { "name": "fake_lsp", "version": "0.0.0" }
                }
            })
        } else if method == "shutdown" {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": null
            })
        } else if let Some(canned_value) = canned.get(method) {
            build_canned_response(id, canned_value)
        } else {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": format!("fake_lsp: no canned response for {method}")
                }
            })
        };

        let body = serde_json::to_vec(&response_body)?;
        if log_enabled {
            eprintln!("[fake_lsp] -> {}", String::from_utf8_lossy(&body));
        }
        if let Err(e) = daisu_lsp::framing::write_frame(&mut stdout, &body).await {
            if log_enabled {
                eprintln!("[fake_lsp] write error: {e}");
            }
            break;
        }
        if let Err(e) = stdout.flush().await {
            if log_enabled {
                eprintln!("[fake_lsp] flush error: {e}");
            }
            break;
        }
    }
    Ok(())
}

fn default_capabilities() -> Value {
    json!({
        "definitionProvider": true,
        "referencesProvider": true,
        "documentSymbolProvider": true,
        "workspaceSymbolProvider": true
    })
}

fn build_canned_response(id: Option<Value>, canned: &Value) -> Value {
    // Caller can write either:
    //   "<method>": <result-json>           — shorthand for result
    //   "<method>": { "result": <...> }     — explicit
    //   "<method>": { "error": { "code": N, "message": "" } }
    if let Some(obj) = canned.as_object() {
        if let Some(err) = obj.get("error") {
            return json!({ "jsonrpc": "2.0", "id": id, "error": err.clone() });
        }
        if let Some(result) = obj.get("result") {
            return json!({ "jsonrpc": "2.0", "id": id, "result": result.clone() });
        }
    }
    json!({ "jsonrpc": "2.0", "id": id, "result": canned.clone() })
}
