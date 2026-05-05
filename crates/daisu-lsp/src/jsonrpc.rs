//! JSON-RPC 2.0 envelope types and `id` correlation.

use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicI64, Ordering},
    Arc,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{oneshot, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Message {
    Request(Request),
    Response(Response),
    Notification(Notification),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub jsonrpc: String,
    pub id: RequestId,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub jsonrpc: String,
    pub id: RequestId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(untagged)]
pub enum RequestId {
    Number(i64),
    String(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Tracks in-flight requests by id so incoming responses can be
/// dispatched to the awaiting caller.
#[derive(Default, Clone)]
pub struct Correlator {
    next_id: Arc<AtomicI64>,
    pending: Arc<Mutex<HashMap<RequestId, oneshot::Sender<Response>>>>,
}

impl Correlator {
    /// Reserve a new request id and return the receiver that will be
    /// notified when the matching response arrives.
    pub async fn reserve(&self) -> (RequestId, oneshot::Receiver<Response>) {
        let id = RequestId::Number(self.next_id.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), tx);
        (id, rx)
    }

    /// Dispatch an incoming response to the awaiting caller. Returns
    /// `false` if no caller is registered (orphan response).
    pub async fn dispatch(&self, resp: Response) -> bool {
        let id = resp.id.clone();
        if let Some(tx) = self.pending.lock().await.remove(&id) {
            let _ = tx.send(resp);
            true
        } else {
            false
        }
    }

    /// Drop a pending entry (used when a request is cancelled).
    pub async fn cancel(&self, id: &RequestId) {
        self.pending.lock().await.remove(id);
    }
}

use tokio::sync::broadcast;

/// Bus carrying server-initiated notifications. Dispatcher publishes;
/// `LspManager` and `Client` subscribe.
#[derive(Clone)]
pub struct NotificationBus {
    tx: broadcast::Sender<Notification>,
}

impl Default for NotificationBus {
    fn default() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self { tx }
    }
}

impl NotificationBus {
    pub fn subscribe(&self) -> broadcast::Receiver<Notification> {
        self.tx.subscribe()
    }

    pub fn publish(&self, n: Notification) {
        let _ = self.tx.send(n);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trips() {
        let raw = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"foo":"bar"}}"#;
        let m: Message = serde_json::from_str(raw).unwrap();
        match m {
            Message::Request(r) => {
                assert_eq!(r.method, "initialize");
                assert_eq!(r.id, RequestId::Number(1));
            }
            _ => panic!("expected request"),
        }
    }

    #[test]
    fn response_with_result_decodes() {
        let raw = r#"{"jsonrpc":"2.0","id":"abc","result":{"ok":true}}"#;
        let m: Message = serde_json::from_str(raw).unwrap();
        match m {
            Message::Response(r) => {
                assert_eq!(r.id, RequestId::String("abc".into()));
                assert!(r.result.is_some());
                assert!(r.error.is_none());
            }
            _ => panic!("expected response"),
        }
    }

    #[test]
    fn response_with_error_decodes() {
        let raw =
            r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"method not found"}}"#;
        let m: Message = serde_json::from_str(raw).unwrap();
        match m {
            Message::Response(r) => {
                let e = r.error.expect("error");
                assert_eq!(e.code, -32601);
            }
            _ => panic!("expected error response"),
        }
    }

    #[test]
    fn notification_has_no_id() {
        let raw = r#"{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":3}}"#;
        let m: Message = serde_json::from_str(raw).unwrap();
        match m {
            Message::Notification(n) => assert_eq!(n.method, "$/cancelRequest"),
            _ => panic!("expected notification"),
        }
    }

    #[test]
    fn request_with_no_params_decodes() {
        let raw = r#"{"jsonrpc":"2.0","id":1,"method":"shutdown"}"#;
        let m: Message = serde_json::from_str(raw).unwrap();
        match m {
            Message::Request(r) => assert!(r.params.is_none()),
            _ => panic!("expected request"),
        }
    }

    #[tokio::test]
    async fn reserve_returns_unique_ids() {
        let c = Correlator::default();
        let (id1, _) = c.reserve().await;
        let (id2, _) = c.reserve().await;
        assert_ne!(id1, id2);
    }

    #[tokio::test]
    async fn dispatch_delivers_response_to_awaiter() {
        let c = Correlator::default();
        let (id, rx) = c.reserve().await;
        let response = Response {
            jsonrpc: "2.0".into(),
            id: id.clone(),
            result: Some(serde_json::json!({"ok": true})),
            error: None,
        };
        let dispatched = c.dispatch(response).await;
        assert!(dispatched);
        let got = rx.await.unwrap();
        assert_eq!(got.id, id);
    }

    #[tokio::test]
    async fn dispatch_orphan_returns_false() {
        let c = Correlator::default();
        let response = Response {
            jsonrpc: "2.0".into(),
            id: RequestId::Number(999),
            result: None,
            error: None,
        };
        assert!(!c.dispatch(response).await);
    }

    #[tokio::test]
    async fn notification_bus_fanout() {
        let bus = NotificationBus::default();
        let mut a = bus.subscribe();
        let mut b = bus.subscribe();
        bus.publish(Notification {
            jsonrpc: "2.0".into(),
            method: "x".into(),
            params: None,
        });
        assert_eq!(a.recv().await.unwrap().method, "x");
        assert_eq!(b.recv().await.unwrap().method, "x");
    }

    #[tokio::test]
    async fn cancel_removes_pending_entry() {
        let c = Correlator::default();
        let (id, mut rx) = c.reserve().await;
        c.cancel(&id).await;
        // The receiver's tx half was dropped on cancel, so awaiting now
        // resolves to Err instead of producing a value.
        match tokio::time::timeout(std::time::Duration::from_millis(10), &mut rx).await {
            Ok(Err(_)) => {} // expected: sender dropped
            other => panic!("expected closed receiver, got {other:?}"),
        }
    }
}
