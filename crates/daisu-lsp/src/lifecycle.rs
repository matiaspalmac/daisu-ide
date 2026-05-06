//! Document lifecycle: didOpen / didChange / didClose with a 200 ms
//! debounce on outgoing didChange.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use lsp_types::Uri;
use parking_lot::Mutex;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::sleep;

use crate::jsonrpc::Notification;
use crate::LspError;

const DEBOUNCE_MS: u64 = 200;

pub struct Lifecycle {
    state: Arc<Mutex<HashMap<Uri, DocState>>>,
    outgoing: mpsc::UnboundedSender<Vec<u8>>,
}

struct DocState {
    #[allow(dead_code)]
    language_id: String,
    text: String,
    version: i32,
    pending: Option<JoinHandle<()>>,
}

impl Lifecycle {
    #[must_use]
    pub fn new(outgoing: mpsc::UnboundedSender<Vec<u8>>) -> Self {
        Self {
            state: Arc::new(Mutex::new(HashMap::new())),
            outgoing,
        }
    }

    pub fn did_open(&self, uri: Uri, language_id: String, text: String) -> Result<(), LspError> {
        let version = 1;
        {
            let mut s = self.state.lock();
            s.insert(
                uri.clone(),
                DocState {
                    language_id: language_id.clone(),
                    text: text.clone(),
                    version,
                    pending: None,
                },
            );
        }
        let notif = Notification {
            jsonrpc: "2.0".into(),
            method: "textDocument/didOpen".into(),
            params: Some(serde_json::json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": language_id,
                    "version": version,
                    "text": text,
                }
            })),
        };
        self.outgoing
            .send(serde_json::to_vec(&notif)?)
            .map_err(|e| LspError::Rpc(format!("send didOpen: {e}")))?;
        Ok(())
    }

    pub fn did_change(&self, uri: Uri, new_text: String) -> Result<(), LspError> {
        let snapshot = {
            let mut s = self.state.lock();
            let doc = s.get_mut(&uri).ok_or_else(|| {
                LspError::Rpc(format!("didChange before didOpen for {}", uri.as_str()))
            })?;
            doc.version += 1;
            doc.text = new_text.clone();
            if let Some(h) = doc.pending.take() {
                h.abort();
            }
            (doc.version, doc.text.clone())
        };

        let outgoing = self.outgoing.clone();
        let uri_clone = uri.clone();
        let state_clone = self.state.clone();
        let handle = tokio::spawn(async move {
            sleep(Duration::from_millis(DEBOUNCE_MS)).await;
            {
                let s = state_clone.lock();
                if s.get(&uri_clone).is_none() {
                    return;
                }
            }
            let notif = Notification {
                jsonrpc: "2.0".into(),
                method: "textDocument/didChange".into(),
                params: Some(serde_json::json!({
                    "textDocument": { "uri": uri_clone, "version": snapshot.0 },
                    "contentChanges": [ { "text": snapshot.1 } ]
                })),
            };
            if let Ok(bytes) = serde_json::to_vec(&notif) {
                let _ = outgoing.send(bytes);
            }
        });

        let mut s = self.state.lock();
        if let Some(doc) = s.get_mut(&uri) {
            doc.pending = Some(handle);
        }
        Ok(())
    }

    pub fn did_close(&self, uri: Uri) -> Result<(), LspError> {
        {
            let mut s = self.state.lock();
            if let Some(mut doc) = s.remove(&uri) {
                if let Some(h) = doc.pending.take() {
                    h.abort();
                }
            }
        }
        let notif = Notification {
            jsonrpc: "2.0".into(),
            method: "textDocument/didClose".into(),
            params: Some(serde_json::json!({
                "textDocument": { "uri": uri }
            })),
        };
        self.outgoing
            .send(serde_json::to_vec(&notif)?)
            .map_err(|e| LspError::Rpc(format!("send didClose: {e}")))?;
        Ok(())
    }

    #[must_use]
    pub fn version(&self, uri: &Uri) -> Option<i32> {
        self.state.lock().get(uri).map(|d| d.version)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn did_open_emits_notification_immediately() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let lc = Lifecycle::new(tx);
        let uri: Uri = "file:///tmp/a.rs".parse().unwrap();
        lc.did_open(uri.clone(), "rust".into(), "fn main(){}".into())
            .unwrap();
        let raw = rx.recv().await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        assert_eq!(v["method"], "textDocument/didOpen");
    }

    #[tokio::test]
    async fn did_change_debounces_to_one_notification() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let lc = Lifecycle::new(tx);
        let uri: Uri = "file:///tmp/a.rs".parse().unwrap();
        lc.did_open(uri.clone(), "rust".into(), "x".into()).unwrap();
        let _ = rx.recv().await;
        for n in 0..5 {
            lc.did_change(uri.clone(), format!("x{n}")).unwrap();
        }
        tokio::time::sleep(Duration::from_millis(350)).await;
        let raw = rx.recv().await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        assert_eq!(v["method"], "textDocument/didChange");
        assert_eq!(v["params"]["textDocument"]["version"], 6);
        assert_eq!(v["params"]["contentChanges"][0]["text"], "x4");
        assert!(rx.try_recv().is_err());
    }
}
