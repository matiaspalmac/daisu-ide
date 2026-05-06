//! Initialize / initialized / shutdown handshake.

use std::path::Path;

use std::str::FromStr;

use lsp_types::{
    ClientCapabilities, GeneralClientCapabilities, InitializeParams, InitializeResult,
    PositionEncodingKind, TextDocumentClientCapabilities, Uri, WorkspaceFolder,
};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::jsonrpc::{Correlator, Notification, Request, Response};
use crate::LspError;

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

pub async fn perform_initialize(
    correlator: &Correlator,
    outgoing: &mpsc::UnboundedSender<Vec<u8>>,
    workspace: &Path,
) -> Result<InitializeResult, LspError> {
    let (id, rx) = correlator.reserve().await;
    let req = Request {
        jsonrpc: "2.0".into(),
        id,
        method: "initialize".into(),
        params: Some(serde_json::to_value(build_initialize_params(workspace)?)?),
    };
    let bytes = serde_json::to_vec(&req)?;
    outgoing
        .send(bytes)
        .map_err(|e| LspError::Rpc(format!("send initialize: {e}")))?;

    let resp: Response = rx
        .await
        .map_err(|e| LspError::Rpc(format!("await initialize: {e}")))?;
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
}
