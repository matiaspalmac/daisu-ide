//! Typed senders for the request methods used by M4.1.

use std::sync::Arc;

use lsp_types::{
    CompletionItem, CompletionParams, CompletionResponse, Hover, HoverParams, SignatureHelp,
    SignatureHelpParams,
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
