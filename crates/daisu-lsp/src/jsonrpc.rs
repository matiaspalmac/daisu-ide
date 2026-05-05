//! JSON-RPC 2.0 envelope types and `id` correlation.

use serde::{Deserialize, Serialize};
use serde_json::Value;

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
}
