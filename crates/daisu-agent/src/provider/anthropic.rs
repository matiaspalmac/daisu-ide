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
    CompletionRequest, CompletionResponse, LlmProvider, ProviderId, Role, StreamEvent,
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

#[derive(Debug, Deserialize)]
struct EnvelopeUsage {
    input_tokens: u32,
    output_tokens: u32,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SseEvent {
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
        "Anthropic Claude"
    }

    fn supported_tools(&self) -> ToolCapability {
        ToolCapability {
            function_calls: true,
            parallel_calls: true,
        }
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
            let resp = if status.is_success() {
                resp
            } else {
                let text = resp.text().await.unwrap_or_default();
                let msg = serde_json::from_str::<ApiError>(&text).map_or_else(
                    |_| format!("status {status}: {text}"),
                    |e| e.error.message,
                );
                Err::<reqwest::Response, _>(AgentError::Provider(msg))?;
                unreachable!()
            };

            let mut events = resp.bytes_stream().eventsource();
            let mut finish_reason: Option<String> = None;
            let mut usage: Option<TokenUsage> = None;

            while let Some(event) = events.next().await {
                let event = event.map_err(|e| AgentError::Provider(format!("sse: {e}")))?;
                if event.data.is_empty() { continue; }
                let parsed: Result<SseEvent, _> = serde_json::from_str(&event.data);
                match parsed {
                    Ok(SseEvent::ContentBlockDelta { delta: SseDelta::TextDelta { text } }) => {
                        yield StreamEvent::Delta { text };
                    }
                    Ok(SseEvent::MessageDelta { delta, usage: u }) => {
                        if let Some(reason) = delta.stop_reason {
                            finish_reason = Some(reason);
                        }
                        if let Some(u) = u {
                            usage = Some(TokenUsage {
                                input_tokens: u.input_tokens,
                                output_tokens: u.output_tokens,
                            });
                        }
                    }
                    Ok(SseEvent::MessageStop) => break,
                    Ok(_) => {}
                    Err(e) => {
                        yield StreamEvent::Warning { message: format!("parse: {e}") };
                    }
                }
            }

            yield StreamEvent::Done { finish_reason, usage };
        };

        Box::pin(stream)
    }
}
