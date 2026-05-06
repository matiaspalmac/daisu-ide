//! Dispatcher: pumps `Transport.incoming` → routes responses to
//! `Correlator`, notifications to `NotificationBus`. Server-initiated
//! requests are auto-replied with a method-not-found error.

use serde_json::Value;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::jsonrpc::{Correlator, Message, NotificationBus, Response, RpcError};

pub struct Dispatcher {
    pub handle: JoinHandle<()>,
}

impl Dispatcher {
    #[must_use]
    pub fn spawn(
        mut incoming: mpsc::UnboundedReceiver<Vec<u8>>,
        outgoing: mpsc::UnboundedSender<Vec<u8>>,
        correlator: Correlator,
        bus: NotificationBus,
    ) -> Self {
        let handle = tokio::spawn(async move {
            while let Some(bytes) = incoming.recv().await {
                let msg: Message = match serde_json::from_slice(&bytes) {
                    Ok(m) => m,
                    Err(e) => {
                        tracing::warn!("dispatcher: bad frame: {e}");
                        continue;
                    }
                };
                match msg {
                    Message::Response(r) => {
                        if !correlator.dispatch(r).await {
                            tracing::debug!("dispatcher: orphan response");
                        }
                    }
                    Message::Notification(n) => bus.publish(n),
                    Message::Request(r) => {
                        // Auto-reply with method-not-found.
                        let resp = Response {
                            jsonrpc: "2.0".into(),
                            id: r.id,
                            result: Some(Value::Null),
                            error: Some(RpcError {
                                code: -32601,
                                message: format!("method not found: {}", r.method),
                                data: None,
                            }),
                        };
                        if let Ok(bytes) = serde_json::to_vec(&resp) {
                            let _ = outgoing.send(bytes);
                        }
                    }
                }
            }
        });
        Self { handle }
    }
}
