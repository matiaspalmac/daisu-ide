//! Typed senders for the request methods used by M4.1.

use std::sync::Arc;

use lsp_types::{
    CompletionItem, CompletionParams, CompletionResponse, DocumentSymbolParams,
    DocumentSymbolResponse, GotoDefinitionParams, GotoDefinitionResponse, Hover, HoverParams,
    Location, ReferenceParams, SignatureHelp, SignatureHelpParams, WorkspaceSymbolParams,
    WorkspaceSymbolResponse,
};
use serde_json::Value;
use tokio::sync::mpsc;

use crate::client::Client;
use crate::jsonrpc::{Notification, Request, RequestId, Response};
use crate::LspError;

pub struct RequestHandle {
    pub id: RequestId,
    pub correlator: crate::jsonrpc::Correlator,
    pub outgoing: mpsc::UnboundedSender<Vec<u8>>,
}

impl RequestHandle {
    pub async fn cancel(self) {
        let notif = Notification {
            jsonrpc: "2.0".into(),
            method: "$/cancelRequest".into(),
            params: Some(serde_json::json!({ "id": self.id })),
        };
        if let Ok(bytes) = serde_json::to_vec(&notif) {
            let _ = self.outgoing.send(bytes);
        }
        self.correlator.cancel(&self.id).await;
    }
}

async fn send_request<T>(
    client: &Client,
    method: &str,
    params: Value,
) -> Result<(T, RequestId), LspError>
where
    T: serde::de::DeserializeOwned + Default,
{
    let (id, rx) = client.correlator.reserve().await;
    let req = Request {
        jsonrpc: "2.0".into(),
        id: id.clone(),
        method: method.into(),
        params: Some(params),
    };
    client
        .outgoing
        .send(serde_json::to_vec(&req)?)
        .map_err(|e| LspError::Rpc(format!("send {method}: {e}")))?;
    let resp: Response = rx
        .await
        .map_err(|_| LspError::Rpc(format!("{method} cancelled")))?;
    if let Some(err) = resp.error {
        return Err(LspError::Rpc(format!(
            "{method}: {} (code {})",
            err.message, err.code
        )));
    }
    let raw = resp.result.unwrap_or(Value::Null);
    let parsed: T = if raw.is_null() {
        T::default()
    } else {
        serde_json::from_value(raw)?
    };
    Ok((parsed, id))
}

#[derive(Default, Debug, Clone)]
pub struct CompletionResult(pub Option<CompletionResponse>);

impl<'de> serde::Deserialize<'de> for CompletionResult {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Self(Option::<CompletionResponse>::deserialize(d)?))
    }
}

pub async fn completion(
    client: Arc<Client>,
    params: CompletionParams,
) -> Result<(CompletionResult, RequestId), LspError> {
    send_request(
        &client,
        "textDocument/completion",
        serde_json::to_value(params)?,
    )
    .await
}

pub async fn completion_resolve(
    client: Arc<Client>,
    item: CompletionItem,
) -> Result<(CompletionItem, RequestId), LspError> {
    send_request(
        &client,
        "completionItem/resolve",
        serde_json::to_value(item)?,
    )
    .await
}

#[derive(Default, Debug, Clone)]
pub struct HoverResult(pub Option<Hover>);

impl<'de> serde::Deserialize<'de> for HoverResult {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Self(Option::<Hover>::deserialize(d)?))
    }
}

pub async fn hover(
    client: Arc<Client>,
    params: HoverParams,
) -> Result<(HoverResult, RequestId), LspError> {
    send_request(&client, "textDocument/hover", serde_json::to_value(params)?).await
}

#[derive(Default, Debug, Clone)]
pub struct SignatureHelpResult(pub Option<SignatureHelp>);

impl<'de> serde::Deserialize<'de> for SignatureHelpResult {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Self(Option::<SignatureHelp>::deserialize(d)?))
    }
}

pub async fn signature_help(
    client: Arc<Client>,
    params: SignatureHelpParams,
) -> Result<(SignatureHelpResult, RequestId), LspError> {
    send_request(
        &client,
        "textDocument/signatureHelp",
        serde_json::to_value(params)?,
    )
    .await
}

#[derive(Default, Debug, Clone)]
pub struct DefinitionResult(pub Option<GotoDefinitionResponse>);

impl<'de> serde::Deserialize<'de> for DefinitionResult {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Self(Option::<GotoDefinitionResponse>::deserialize(d)?))
    }
}

pub async fn definition(
    client: Arc<Client>,
    params: GotoDefinitionParams,
) -> Result<(DefinitionResult, RequestId), LspError> {
    send_request(
        &client,
        "textDocument/definition",
        serde_json::to_value(params)?,
    )
    .await
}

#[derive(Default, Debug, Clone)]
struct ReferencesResult(Vec<Location>);

impl<'de> serde::Deserialize<'de> for ReferencesResult {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let opt = Option::<Vec<Location>>::deserialize(d)?;
        Ok(Self(opt.unwrap_or_default()))
    }
}

pub async fn references(
    client: Arc<Client>,
    params: ReferenceParams,
) -> Result<(Vec<Location>, RequestId), LspError> {
    let (raw, id): (ReferencesResult, _) = send_request(
        &client,
        "textDocument/references",
        serde_json::to_value(params)?,
    )
    .await?;
    Ok((raw.0, id))
}

#[derive(Default, Debug, Clone)]
pub struct DocumentSymbolResult(pub Option<DocumentSymbolResponse>);

impl<'de> serde::Deserialize<'de> for DocumentSymbolResult {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Self(Option::<DocumentSymbolResponse>::deserialize(d)?))
    }
}

pub async fn document_symbol(
    client: Arc<Client>,
    params: DocumentSymbolParams,
) -> Result<(DocumentSymbolResult, RequestId), LspError> {
    send_request(
        &client,
        "textDocument/documentSymbol",
        serde_json::to_value(params)?,
    )
    .await
}

#[derive(Default, Debug, Clone)]
pub struct WorkspaceSymbolResult(pub Option<WorkspaceSymbolResponse>);

impl<'de> serde::Deserialize<'de> for WorkspaceSymbolResult {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Self(Option::<WorkspaceSymbolResponse>::deserialize(d)?))
    }
}

pub async fn workspace_symbol(
    client: Arc<Client>,
    params: WorkspaceSymbolParams,
) -> Result<(WorkspaceSymbolResult, RequestId), LspError> {
    send_request(&client, "workspace/symbol", serde_json::to_value(params)?).await
}
