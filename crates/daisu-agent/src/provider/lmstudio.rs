//! LM Studio local provider — OpenAI Chat Completions compatible.
//!
//! Targets `http://localhost:1234/v1/chat/completions` by default. No
//! API key required. Streams via SSE with the standard OpenAI Chat
//! Completions chunk shape.

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

pub struct LmStudioProvider {
    client: reqwest::Client,
    base_url: String,
}

impl LmStudioProvider {
    pub fn new(base_url: impl Into<String>) -> AgentResult<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .build()?;
        Ok(Self {
            client,
            base_url: base_url.into(),
        })
    }

    fn build_body(req: &CompletionRequest, stream: bool) -> serde_json::Value {
        let mut messages: Vec<serde_json::Value> = Vec::with_capacity(req.messages.len() + 1);
        if let Some(sys) = req.system.as_deref() {
            messages.push(json!({ "role": "system", "content": sys }));
        }
        for m in &req.messages {
            let role = match m.role {
                Role::System => "system",
                Role::User => "user",
                Role::Assistant => "assistant",
                Role::Tool => "tool",
            };
            messages.push(json!({ "role": role, "content": m.content }));
        }
        let mut body = json!({
            "model": req.model,
            "messages": messages,
            "max_tokens": req.max_tokens,
            "stream": stream,
        });
        if let Some(t) = req.temperature {
            body["temperature"] = json!(t);
        }
        body
    }
}

impl Default for LmStudioProvider {
    fn default() -> Self {
        Self::new("http://localhost:1234/v1").expect("default reqwest client builds")
    }
}

#[derive(Debug, Deserialize)]
struct ChatEnvelope {
    choices: Vec<Choice>,
    model: String,
    #[serde(default)]
    usage: Option<OaiUsage>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ChoiceMessage,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChoiceMessage {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OaiUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct ChatChunk {
    #[serde(default)]
    choices: Vec<ChoiceDelta>,
    #[serde(default)]
    usage: Option<OaiUsage>,
}

#[derive(Debug, Deserialize)]
struct ChoiceDelta {
    #[serde(default)]
    delta: DeltaBody,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct DeltaBody {
    #[serde(default)]
    content: Option<String>,
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
    data: Vec<LmsModel>,
}

#[derive(Deserialize)]
struct LmsModel {
    id: String,
}

#[async_trait]
impl LlmProvider for LmStudioProvider {
    fn id(&self) -> ProviderId {
        ProviderId::LmStudio
    }

    fn name(&self) -> &str {
        "LM Studio (local)"
    }

    fn supported_tools(&self) -> ToolCapability {
        // LM Studio supports tool calls for capable models, but parallel
        // calls and streaming-args reliability vary by model — flag as
        // sequential-only until per-model probing lands.
        ToolCapability {
            function_calls: true,
            parallel_calls: false,
        }
    }

    fn default_model(&self) -> &str {
        // No fixed default — UI should fall back to the first id in
        // `list_models`. We pick a sensible placeholder so the trait
        // doesn't return empty.
        "loaded-model"
    }

    async fn list_models(&self) -> AgentResult<Vec<ModelInfo>> {
        let resp = self
            .client
            .get(format!("{}/models", self.base_url))
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
            .post(format!("{}/chat/completions", self.base_url))
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
        let env: ChatEnvelope = serde_json::from_str(&text)?;
        let first = env.choices.into_iter().next();
        let (content, finish) = first.map_or((String::new(), None), |c| {
            (c.message.content.unwrap_or_default(), c.finish_reason)
        });
        Ok(CompletionResponse {
            content,
            model: env.model,
            finish_reason: finish,
            usage: env.usage.map(|u| TokenUsage {
                input_tokens: u.prompt_tokens,
                output_tokens: u.completion_tokens,
            }),
        })
    }

    fn stream(&self, req: CompletionRequest) -> StreamResult {
        let body = Self::build_body(&req, true);
        let client = self.client.clone();
        let url = format!("{}/chat/completions", self.base_url);

        let stream = async_stream::try_stream! {
            let resp = client
                .post(&url)
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
                match serde_json::from_str::<ChatChunk>(&event.data) {
                    Ok(chunk) => {
                        for choice in chunk.choices {
                            if let Some(text) = choice.delta.content {
                                if !text.is_empty() {
                                    yield StreamEvent::Delta { text };
                                }
                            }
                            if let Some(r) = choice.finish_reason {
                                finish_reason = Some(r);
                            }
                        }
                        if let Some(u) = chunk.usage {
                            usage = Some(TokenUsage {
                                input_tokens: u.prompt_tokens,
                                output_tokens: u.completion_tokens,
                            });
                        }
                    }
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
