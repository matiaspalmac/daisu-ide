//! Anthropic Claude provider.
//!
//! Targets the `/v1/messages` endpoint with streaming SSE. Uses the
//! `2023-06-01` API version, which is the stable channel through 2026.

use std::time::Duration;

use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::stream::StreamExt;
use serde::Deserialize;
use serde_json::json;

use super::{
    CompletionRequest, CompletionResponse, LlmProvider, ModelInfo, ProviderId, Role, StreamEvent,
    StreamResult, TokenUsage, ToolCapability,
};
use crate::error::{AgentError, AgentResult};

const API_BASE: &str = "https://api.anthropic.com/v1";
const API_VERSION: &str = "2023-06-01";

pub struct AnthropicProvider {
    client: reqwest::Client,
    api_key: String,
}

impl AnthropicProvider {
    pub fn new(api_key: impl Into<String>) -> AgentResult<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()?;
        Ok(Self {
            client,
            api_key: api_key.into(),
        })
    }

    fn build_body(req: &CompletionRequest, stream: bool) -> serde_json::Value {
        let messages: Vec<_> = req
            .messages
            .iter()
            .filter(|m| !matches!(m.role, Role::System))
            .map(|m| {
                let role = match m.role {
                    Role::User | Role::Tool => "user",
                    Role::Assistant => "assistant",
                    Role::System => unreachable!(),
                };
                json!({ "role": role, "content": m.content })
            })
            .collect();

        let system = req.system.clone().or_else(|| {
            req.messages
                .iter()
                .find(|m| matches!(m.role, Role::System))
                .map(|m| m.content.clone())
        });

        let mut body = json!({
            "model": req.model,
            "max_tokens": req.max_tokens,
            "messages": messages,
            "stream": stream,
        });
        if let Some(sys) = system {
            body["system"] = json!(sys);
        }
        if let Some(temp) = req.temperature {
            body["temperature"] = json!(temp);
        }
        body
    }
}

#[derive(Debug, Deserialize)]
struct CompletionEnvelope {
    content: Vec<ContentBlock>,
    model: String,
    stop_reason: Option<String>,
    usage: Option<EnvelopeUsage>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ContentBlock {
    Text {
        text: String,
    },
    #[serde(other)]
    Other,
}

/// Anthropic surfaces token usage in three different shapes:
/// - Non-streaming response: both fields present.
/// - SSE `message_start`: both present (input final, output starts low).
/// - SSE `message_delta`: only `output_tokens` (the running total).
///
/// Marking both `#[serde(default)]` lets us decode all three without
/// silently failing the `message_delta` parse — a bug that previously
/// stripped usage off every streamed Claude response.
#[derive(Debug, Deserialize, Default, Clone, Copy)]
struct EnvelopeUsage {
    #[serde(default)]
    input_tokens: u32,
    #[serde(default)]
    output_tokens: u32,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SseEvent {
    /// First event of every stream — carries the initial usage snapshot
    /// (input_tokens final, output_tokens 0..N).
    MessageStart {
        message: MessageStartPayload,
    },
    ContentBlockDelta {
        delta: SseDelta,
    },
    MessageDelta {
        delta: SseMessageDelta,
        usage: Option<EnvelopeUsage>,
    },
    MessageStop,
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct MessageStartPayload {
    #[serde(default)]
    usage: Option<EnvelopeUsage>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SseDelta {
    TextDelta {
        text: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize, Default)]
struct SseMessageDelta {
    stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    error: ApiErrorBody,
}

#[derive(Deserialize)]
struct ModelListEnv {
    data: Vec<AnthropicModel>,
}

#[derive(Deserialize)]
struct AnthropicModel {
    id: String,
    #[serde(default)]
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiErrorBody {
    #[allow(dead_code)]
    r#type: String,
    message: String,
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Anthropic
    }

    fn name(&self) -> &str {
        ProviderId::Anthropic.display_name()
    }

    fn supported_tools(&self) -> ToolCapability {
        ProviderId::Anthropic.capabilities()
    }

    fn default_model(&self) -> &str {
        ProviderId::Anthropic.default_model()
    }

    async fn list_models(&self) -> AgentResult<Vec<ModelInfo>> {
        let resp = self
            .client
            .get(format!("{API_BASE}/models?limit=1000"))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(AgentError::Provider(format!("models {status}: {text}")));
        }
        let env: ModelListEnv = serde_json::from_str(&text)?;
        Ok(env
            .data
            .into_iter()
            .map(|m| ModelInfo {
                id: m.id,
                display_name: m.display_name,
                // Anthropic's catalog endpoint doesn't expose context
                // window — leave None rather than hardcoding 200k, which
                // will lie the moment a wider-context model ships.
                context_window: None,
                supports_tools: true,
            })
            .collect())
    }

    async fn complete(&self, req: CompletionRequest) -> AgentResult<CompletionResponse> {
        let body = Self::build_body(&req, false);
        let resp = self
            .client
            .post(format!("{API_BASE}/messages"))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            if let Ok(err) = serde_json::from_str::<ApiError>(&text) {
                return Err(AgentError::Provider(err.error.message));
            }
            return Err(AgentError::Provider(format!("status {status}: {text}")));
        }

        let env: CompletionEnvelope = serde_json::from_str(&text)?;
        let content: String = env
            .content
            .into_iter()
            .filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text),
                ContentBlock::Other => None,
            })
            .collect();

        Ok(CompletionResponse {
            content,
            model: env.model,
            finish_reason: env.stop_reason,
            usage: env.usage.map(|u| TokenUsage {
                input_tokens: u.input_tokens,
                output_tokens: u.output_tokens,
            }),
        })
    }

    fn stream(&self, req: CompletionRequest) -> StreamResult {
        let body = Self::build_body(&req, true);
        let client = self.client.clone();
        let api_key = self.api_key.clone();

        let stream = async_stream::try_stream! {
            let resp = client
                .post(format!("{API_BASE}/messages"))
                .header("x-api-key", &api_key)
                .header("anthropic-version", API_VERSION)
                .header("content-type", "application/json")
                .header("accept", "text/event-stream")
                .json(&body)
                .send()
                .await?;

            let status = resp.status();
            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                let msg = serde_json::from_str::<ApiError>(&text).map_or_else(
                    |_| format!("status {status}: {text}"),
                    |e| e.error.message,
                );
                Err::<(), _>(AgentError::Provider(msg))?;
                return;
            }

            let mut events = resp.bytes_stream().eventsource();
            let mut finish_reason: Option<String> = None;
            // Accumulate usage across event types: message_start brings
            // input_tokens, message_delta keeps overwriting output_tokens.
            let mut input_tokens: u32 = 0;
            let mut output_tokens: u32 = 0;
            let mut saw_usage = false;

            while let Some(event) = events.next().await {
                let event = event.map_err(|e| AgentError::Provider(format!("sse: {e}")))?;
                if event.data.is_empty() { continue; }
                let parsed: Result<SseEvent, _> = serde_json::from_str(&event.data);
                match parsed {
                    Ok(SseEvent::MessageStart { message }) => {
                        if let Some(u) = message.usage {
                            input_tokens = u.input_tokens;
                            output_tokens = u.output_tokens;
                            saw_usage = true;
                        }
                    }
                    Ok(SseEvent::ContentBlockDelta { delta: SseDelta::TextDelta { text } }) => {
                        yield StreamEvent::Delta { text };
                    }
                    Ok(SseEvent::MessageDelta { delta, usage: u }) => {
                        if let Some(reason) = delta.stop_reason {
                            finish_reason = Some(reason);
                        }
                        if let Some(u) = u {
                            // message_delta only ships output_tokens; preserve
                            // the input count we captured at message_start.
                            output_tokens = u.output_tokens;
                            saw_usage = true;
                        }
                    }
                    Ok(SseEvent::MessageStop) => break,
                    Ok(_) => {}
                    Err(e) => {
                        yield StreamEvent::Warning { message: format!("parse: {e}") };
                    }
                }
            }

            let usage = if saw_usage {
                Some(TokenUsage { input_tokens, output_tokens })
            } else {
                None
            };
            yield StreamEvent::Done { finish_reason, usage };
        };

        Box::pin(stream)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_start_decodes_with_full_usage() {
        let raw =
            r#"{"type":"message_start","message":{"usage":{"input_tokens":42,"output_tokens":1}}}"#;
        let parsed: SseEvent = serde_json::from_str(raw).unwrap();
        match parsed {
            SseEvent::MessageStart { message } => {
                let u = message.usage.expect("usage");
                assert_eq!(u.input_tokens, 42);
                assert_eq!(u.output_tokens, 1);
            }
            _ => panic!("expected MessageStart"),
        }
    }

    #[test]
    fn message_delta_decodes_with_only_output_tokens() {
        // Regression: Anthropic only ships output_tokens on
        // message_delta, but the previous EnvelopeUsage required both
        // fields and silently failed every parse.
        let raw = r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":99}}"#;
        let parsed: SseEvent = serde_json::from_str(raw).unwrap();
        match parsed {
            SseEvent::MessageDelta { delta, usage } => {
                assert_eq!(delta.stop_reason.as_deref(), Some("end_turn"));
                let u = usage.expect("usage");
                assert_eq!(u.input_tokens, 0);
                assert_eq!(u.output_tokens, 99);
            }
            _ => panic!("expected MessageDelta"),
        }
    }

    #[test]
    fn content_block_delta_decodes_text() {
        let raw = r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}"#;
        let parsed: SseEvent = serde_json::from_str(raw).unwrap();
        match parsed {
            SseEvent::ContentBlockDelta {
                delta: SseDelta::TextDelta { text },
            } => assert_eq!(text, "hello"),
            _ => panic!("expected text delta"),
        }
    }

    #[test]
    fn unknown_event_kinds_decode_as_other() {
        let raw = r#"{"type":"ping"}"#;
        let parsed: SseEvent = serde_json::from_str(raw).unwrap();
        assert!(matches!(parsed, SseEvent::Other));
    }
}
