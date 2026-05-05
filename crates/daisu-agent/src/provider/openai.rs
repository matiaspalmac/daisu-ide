//! OpenAI provider — Responses API (`/v1/responses`).
//!
//! Uses the typed-event SSE stream introduced with the Responses API.
//! Chat Completions still works but OpenAI recommends Responses for new
//! integrations and reasoning-class models (gpt-5.x) require it.

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

const API_BASE: &str = "https://api.openai.com/v1";

pub struct OpenAiProvider {
    client: reqwest::Client,
    api_key: String,
}

impl OpenAiProvider {
    pub fn new(api_key: impl Into<String>) -> AgentResult<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .build()?;
        Ok(Self {
            client,
            api_key: api_key.into(),
        })
    }

    fn build_body(req: &CompletionRequest, stream: bool) -> serde_json::Value {
        // The Responses API uses `instructions` for the system prompt and
        // `input` as a list of typed items. We map our flat Message list
        // into role-tagged `message` items with text content parts.
        let instructions = req.system.clone().or_else(|| {
            req.messages
                .iter()
                .find(|m| matches!(m.role, Role::System))
                .map(|m| m.content.clone())
        });

        let input: Vec<_> = req
            .messages
            .iter()
            .filter(|m| !matches!(m.role, Role::System))
            .map(|m| {
                let role = match m.role {
                    Role::User | Role::Tool => "user",
                    Role::Assistant => "assistant",
                    Role::System => unreachable!(),
                };
                // Assistant historical text uses `output_text`, user uses
                // `input_text`. Mixing them up is a 400.
                let part_type = if matches!(m.role, Role::Assistant) {
                    "output_text"
                } else {
                    "input_text"
                };
                json!({
                    "type": "message",
                    "role": role,
                    "content": [{ "type": part_type, "text": m.content }],
                })
            })
            .collect();

        let mut body = json!({
            "model": req.model,
            "input": input,
            "max_output_tokens": req.max_tokens,
            "stream": stream,
        });
        if let Some(sys) = instructions {
            body["instructions"] = json!(sys);
        }
        if let Some(temp) = req.temperature {
            body["temperature"] = json!(temp);
        }
        body
    }
}

#[derive(Debug, Deserialize)]
struct ResponsesEnvelope {
    output: Vec<OutputItem>,
    model: String,
    #[serde(default)]
    usage: Option<EnvelopeUsage>,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OutputItem {
    Message {
        #[serde(default)]
        content: Vec<OutputContent>,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OutputContent {
    OutputText {
        text: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct EnvelopeUsage {
    #[serde(default)]
    input_tokens: u32,
    #[serde(default)]
    output_tokens: u32,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SseEvent {
    #[serde(rename = "response.output_text.delta")]
    OutputTextDelta { delta: String },
    #[serde(rename = "response.completed")]
    Completed { response: CompletedPayload },
    #[serde(rename = "response.failed")]
    Failed { response: FailedPayload },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct CompletedPayload {
    #[serde(default)]
    usage: Option<EnvelopeUsage>,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FailedPayload {
    #[serde(default)]
    error: Option<ErrorPayload>,
}

#[derive(Debug, Deserialize)]
struct ErrorPayload {
    message: String,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    error: ApiErrorBody,
}

#[derive(Debug, Deserialize)]
struct ApiErrorBody {
    message: String,
}

#[derive(Deserialize)]
struct ModelListEnv {
    data: Vec<OaiModel>,
}

#[derive(Deserialize)]
struct OaiModel {
    id: String,
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn id(&self) -> ProviderId {
        ProviderId::OpenAi
    }

    fn name(&self) -> &str {
        "OpenAI"
    }

    fn supported_tools(&self) -> ToolCapability {
        ToolCapability {
            function_calls: true,
            parallel_calls: true,
        }
    }

    fn default_model(&self) -> &str {
        "gpt-5.5"
    }

    async fn list_models(&self) -> AgentResult<Vec<ModelInfo>> {
        let resp = self
            .client
            .get(format!("{API_BASE}/models"))
            .bearer_auth(&self.api_key)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            if let Ok(err) = serde_json::from_str::<ApiError>(&text) {
                return Err(AgentError::Provider(err.error.message));
            }
            return Err(AgentError::Provider(format!("models {status}: {text}")));
        }
        let env: ModelListEnv = serde_json::from_str(&text)?;
        Ok(env
            .data
            .into_iter()
            // Filter to chat-capable model ids; embeddings/tts/whisper noise out.
            .filter(|m| {
                let id = &m.id;
                id.starts_with("gpt-")
                    || id.starts_with("o1")
                    || id.starts_with("o3")
                    || id.starts_with("o4")
                    || id.starts_with("chatgpt-")
            })
            .map(|m| ModelInfo {
                id: m.id,
                display_name: None,
                context_window: None,
                supports_tools: true,
            })
            .collect())
    }

    async fn complete(&self, req: CompletionRequest) -> AgentResult<CompletionResponse> {
        let body = Self::build_body(&req, false);
        let resp = self
            .client
            .post(format!("{API_BASE}/responses"))
            .bearer_auth(&self.api_key)
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

        let env: ResponsesEnvelope = serde_json::from_str(&text)?;
        let content: String = env
            .output
            .into_iter()
            .filter_map(|item| match item {
                OutputItem::Message { content } => Some(content),
                OutputItem::Other => None,
            })
            .flatten()
            .filter_map(|c| match c {
                OutputContent::OutputText { text } => Some(text),
                OutputContent::Other => None,
            })
            .collect();

        Ok(CompletionResponse {
            content,
            model: env.model,
            finish_reason: env.status,
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
                .post(format!("{API_BASE}/responses"))
                .bearer_auth(&api_key)
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
                if event.data.is_empty() || event.data == "[DONE]" { continue; }
                match serde_json::from_str::<SseEvent>(&event.data) {
                    Ok(SseEvent::OutputTextDelta { delta }) => {
                        yield StreamEvent::Delta { text: delta };
                    }
                    Ok(SseEvent::Completed { response }) => {
                        finish_reason = response.status;
                        usage = response.usage.map(|u| TokenUsage {
                            input_tokens: u.input_tokens,
                            output_tokens: u.output_tokens,
                        });
                        break;
                    }
                    Ok(SseEvent::Failed { response }) => {
                        let msg = response.error.map_or_else(
                            || "openai: response failed".to_string(),
                            |e| e.message,
                        );
                        Err(AgentError::Provider(msg))?;
                        unreachable!()
                    }
                    Ok(SseEvent::Error { message }) => {
                        Err(AgentError::Provider(message))?;
                        unreachable!()
                    }
                    Ok(SseEvent::Other) => {}
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
