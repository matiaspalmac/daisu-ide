//! Initialize / initialized / shutdown handshake.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use std::str::FromStr;

use lsp_types::{
    ClientCapabilities, GeneralClientCapabilities, InitializeParams, InitializeResult,
    PositionEncodingKind, TextDocumentClientCapabilities, Uri, WorkspaceFolder,
};
use parking_lot::Mutex;
use serde_json::{json, Value};
use tokio::sync::{mpsc, watch};

use crate::jsonrpc::{Correlator, Notification, Request, Response};
use crate::LspError;

/// Hard cap for a server to answer `initialize`. rust-analyzer cold-starts
/// in 5–10 s on a large repo; 20 s leaves room for slow disks without
/// trapping the user behind a permanent spinner if the server is broken.
const INITIALIZE_TIMEOUT_SECS: u64 = 20;

/// Build a `file://` Uri for an absolute path. Returns an error if the
/// path is not absolute or cannot be converted to a `file:` URL.
pub fn file_uri(path: &Path) -> Result<Uri, LspError> {
    let url = url::Url::from_file_path(path)
        .map_err(|()| LspError::Rpc(format!("path must be absolute: {}", path.display())))?;
    Uri::from_str(url.as_str())
        .map_err(|e| LspError::Rpc(format!("invalid file uri ({}): {e}", path.display())))
}

pub fn build_initialize_params(workspace: &Path) -> Result<InitializeParams, LspError> {
    let uri = file_uri(workspace)?;
    let folder_name = workspace.file_name().map_or_else(
        || "workspace".to_string(),
        |n| n.to_string_lossy().to_string(),
    );
    let mut p = InitializeParams::default();
    p.process_id = Some(std::process::id());
    p.workspace_folders = Some(vec![WorkspaceFolder {
        uri: uri.clone(),
        name: folder_name,
    }]);
    #[allow(deprecated)]
    {
        p.root_uri = Some(uri);
    }
    p.capabilities = ClientCapabilities {
        general: Some(GeneralClientCapabilities {
            position_encodings: Some(vec![PositionEncodingKind::UTF16]),
            ..Default::default()
        }),
        text_document: Some(TextDocumentClientCapabilities {
            ..Default::default()
        }),
        ..Default::default()
    };
    Ok(p)
}

fn format_tail(tail: &Arc<Mutex<Vec<String>>>) -> String {
    let lines = tail.lock();
    if lines.is_empty() {
        String::new()
    } else {
        format!(" — stderr: {}", lines.join(" | "))
    }
}

/// Resolve as soon as `eof_rx` reports `true`. Treats a dropped sender
/// (transport torn down) as EOF, since the server cannot speak LSP
/// without an active reader either way.
async fn wait_for_eof(eof_rx: &mut watch::Receiver<bool>) {
    while !*eof_rx.borrow() {
        if eof_rx.changed().await.is_err() {
            return;
        }
    }
}

pub async fn perform_initialize(
    correlator: &Correlator,
    outgoing: &mpsc::UnboundedSender<Vec<u8>>,
    workspace: &Path,
    mut stdout_eof: watch::Receiver<bool>,
    stderr_tail: Arc<Mutex<Vec<String>>>,
) -> Result<InitializeResult, LspError> {
    // Fast-fail when the child already died before we even get to await
    // the response (rustup proxy stub exits in milliseconds; the reader
    // task can flip `stdout_eof` before this code runs).
    if *stdout_eof.borrow() {
        return Err(LspError::Rpc(format!(
            "server exited before initialize could be sent{}",
            format_tail(&stderr_tail)
        )));
    }

    let (id, mut rx) = correlator.reserve().await;
    let req = Request {
        jsonrpc: "2.0".into(),
        id: id.clone(),
        method: "initialize".into(),
        params: Some(serde_json::to_value(build_initialize_params(workspace)?)?),
    };
    let bytes = serde_json::to_vec(&req)?;
    outgoing
        .send(bytes)
        .map_err(|e| LspError::Rpc(format!("send initialize: {e}")))?;

    // Race the handshake response against (a) the server dying and
    // (b) a hard timeout. Without (a) we hang forever when the server
    // exits before answering — observed in production when the user's
    // `rust-analyzer` was a rustup proxy stub that errors and exits in
    // <50 ms. Without (b) we'd hang on a server that accepts the message
    // but never responds (broken/buggy server, deadlock inside).
    let resp: Response = tokio::select! {
        () = wait_for_eof(&mut stdout_eof) => {
            correlator.cancel(&id).await;
            return Err(LspError::Rpc(format!(
                "server exited before initialize completed{}",
                format_tail(&stderr_tail)
            )));
        }
        () = tokio::time::sleep(Duration::from_secs(INITIALIZE_TIMEOUT_SECS)) => {
            correlator.cancel(&id).await;
            return Err(LspError::Rpc(format!(
                "initialize timed out after {INITIALIZE_TIMEOUT_SECS}s{}",
                format_tail(&stderr_tail)
            )));
        }
        result = &mut rx => {
            result.map_err(|e| LspError::Rpc(format!("await initialize: {e}")))?
        }
    };

    if let Some(err) = resp.error {
        return Err(LspError::Rpc(format!(
            "initialize error {}: {}",
            err.code, err.message
        )));
    }
    let result_val = resp.result.unwrap_or(Value::Null);
    let init_result: InitializeResult = serde_json::from_value(result_val)?;

    let notif = Notification {
        jsonrpc: "2.0".into(),
        method: "initialized".into(),
        params: Some(json!({})),
    };
    let bytes = serde_json::to_vec(&notif)?;
    outgoing
        .send(bytes)
        .map_err(|e| LspError::Rpc(format!("send initialized: {e}")))?;
    Ok(init_result)
}

pub async fn perform_shutdown(
    correlator: &Correlator,
    outgoing: &mpsc::UnboundedSender<Vec<u8>>,
) -> Result<(), LspError> {
    let (id, rx) = correlator.reserve().await;
    let req = Request {
        jsonrpc: "2.0".into(),
        id,
        method: "shutdown".into(),
        params: None,
    };
    outgoing
        .send(serde_json::to_vec(&req)?)
        .map_err(|e| LspError::Rpc(format!("send shutdown: {e}")))?;
    let _ = rx.await;
    let exit = Notification {
        jsonrpc: "2.0".into(),
        method: "exit".into(),
        params: None,
    };
    outgoing
        .send(serde_json::to_vec(&exit)?)
        .map_err(|e| LspError::Rpc(format!("send exit: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn initialize_params_carry_workspace_uri() {
        let tmp = tempfile::tempdir().unwrap();
        let p = build_initialize_params(tmp.path()).unwrap();
        let folder = p.workspace_folders.as_ref().unwrap();
        assert_eq!(folder.len(), 1);
        assert!(folder[0].uri.to_string().starts_with("file:"));
    }

    #[test]
    fn initialize_params_request_utf16_encoding() {
        let tmp = tempfile::tempdir().unwrap();
        let p = build_initialize_params(tmp.path()).unwrap();
        let enc = p.capabilities.general.unwrap().position_encodings.unwrap();
        assert_eq!(enc, vec![PositionEncodingKind::UTF16]);
    }

    #[test]
    fn initialize_params_path_must_be_absolute() {
        let res = build_initialize_params(&PathBuf::from("relative/path"));
        assert!(res.is_err());
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn perform_initialize_returns_when_eof_signalled_first() {
        let tmp = tempfile::tempdir().unwrap();
        let correlator = Correlator::default();
        let (out_tx, _out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (eof_tx, eof_rx) = watch::channel(false);
        let stderr_tail = Arc::new(Mutex::new(vec!["fatal: missing toolchain".into()]));
        // Simulate the child dying before the handshake response arrives.
        let _drop_guard = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            let _ = eof_tx.send(true);
        });
        let err = perform_initialize(&correlator, &out_tx, tmp.path(), eof_rx, stderr_tail)
            .await
            .unwrap_err();
        match err {
            LspError::Rpc(msg) => {
                assert!(
                    msg.contains("server exited before initialize completed"),
                    "{msg}"
                );
                assert!(msg.contains("fatal: missing toolchain"), "{msg}");
            }
            other => panic!("expected Rpc, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn perform_initialize_times_out_when_no_response() {
        let tmp = tempfile::tempdir().unwrap();
        let correlator = Correlator::default();
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (_eof_tx, eof_rx) = watch::channel(false);
        let stderr_tail = Arc::new(Mutex::new(Vec::new()));
        // Drain outgoing in the background so `send` doesn't block, but
        // never produce a response — the timeout branch must fire.
        tokio::spawn(async move { while out_rx.recv().await.is_some() {} });
        let err = perform_initialize(&correlator, &out_tx, tmp.path(), eof_rx, stderr_tail)
            .await
            .unwrap_err();
        match err {
            LspError::Rpc(msg) => assert!(msg.contains("initialize timed out after"), "{msg}"),
            other => panic!("expected Rpc, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn perform_initialize_fast_fails_when_eof_already_set() {
        let tmp = tempfile::tempdir().unwrap();
        let correlator = Correlator::default();
        let (out_tx, _out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (eof_tx, eof_rx) = watch::channel(false);
        eof_tx.send(true).unwrap();
        let stderr_tail = Arc::new(Mutex::new(vec!["Unknown binary".into()]));
        let err = perform_initialize(&correlator, &out_tx, tmp.path(), eof_rx, stderr_tail)
            .await
            .unwrap_err();
        match err {
            LspError::Rpc(msg) => {
                assert!(
                    msg.contains("server exited before initialize could be sent"),
                    "{msg}"
                );
                assert!(msg.contains("Unknown binary"), "{msg}");
            }
            other => panic!("expected Rpc, got {other:?}"),
        }
    }
}
