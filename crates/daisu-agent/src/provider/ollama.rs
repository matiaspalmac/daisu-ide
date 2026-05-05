//! Ollama local provider.
//!
//! Targets `/api/chat` with NDJSON streaming. No API key required — the
//! daemon runs on `localhost:11434` by default.

use std::time::Duration;

use async_trait::async_trait;
use futures::stream::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncBufReadExt;
use tokio_util::io::StreamReader;

use super::{
    CompletionRequest, CompletionResponse, LlmProvider, ModelInfo, ProviderId, Role, StreamEvent,
    StreamResult, TokenUsage, ToolCapability,
};
use crate::error::{AgentError, AgentResult};

pub struct OllamaProvider {
    client: reqwest::Client,
    base_url: String,
}

impl OllamaProvider {
    pub fn new(base_url: impl Into<String>) -> AgentResult<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .build()?;
        Ok(Self {
            client,
            base_url: base_url.into(),
        })
    }
}

impl Default for OllamaProvider {
    fn default() -> Self {
        Self::new("http://localhost:11434").expect("default reqwest client builds")
    }
}

#[derive(Debug, Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    stream: bool,
    options: Options,
}

#[derive(Debug, Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Serialize, Default)]
struct Options {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    model: String,
    message: Option<ChatRespMessage>,
    done: bool,
    #[serde(default)]
    done_reason: Option<String>,
    #[serde(default)]
    prompt_eval_count: Option<u32>,
    #[serde(default)]
    eval_count: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct ChatRespMessage {
    #[allow(dead_code)]
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct TagsEnv {
    models: Vec<TagModel>,
}

#[derive(Deserialize)]
struct TagModel {
    name: String,
    #[serde(default)]
    details: Option<TagDetails>,
}

#[derive(Deserialize)]
struct TagDetails {
    #[serde(default)]
    parameter_size: Option<String>,
}

fn role_str(role: Role) -> &'static str {
    match role {
        Role::System => "system",
        Role::User | Role::Tool => "user",
        Role::Assistant => "assistant",
    }
}

fn build_payload<'a>(req: &'a CompletionRequest, stream: bool) -> ChatRequest<'a> {
    let mut messages: Vec<ChatMessage<'a>> = Vec::with_capacity(req.messages.len() + 1);
    if let Some(sys) = req.system.as_deref() {
        messages.push(ChatMessage {
            role: "system",
            content: sys,
        });
    }
    for m in &req.messages {
        messages.push(ChatMessage {
            role: role_str(m.role),
            content: &m.content,
        });
    }
    ChatRequest {
        model: &req.model,
        messages,
        stream,
        options: Options {
            temperature: req.temperature,
            num_predict: Some(req.max_tokens),
        },
    }
}

#[async_trait]
impl LlmProvider for OllamaProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Ollama
    }

    fn name(&self) -> &str {
        "Ollama (local)"
    }

    fn supported_tools(&self) -> ToolCapability {
        ToolCapability::default()
    }

    fn default_model(&self) -> &str {
        "qwen3-coder"
    }

    async fn list_models(&self) -> AgentResult<Vec<ModelInfo>> {
        let resp = self
            .client
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(AgentError::Provider(format!("tags {status}: {text}")));
        }
        let env: TagsEnv = serde_json::from_str(&text)?;
        Ok(env
            .models
            .into_iter()
            .map(|m| {
                let display = m
                    .details
                    .as_ref()
                    .and_then(|d| d.parameter_size.clone())
                    .map(|s| format!("{} ({s})", m.name));
                ModelInfo {
                    id: m.name,
                    display_name: display,
                    context_window: None,
                    supports_tools: false,
                }
            })
            .collect())
    }

    async fn complete(&self, req: CompletionRequest) -> AgentResult<CompletionResponse> {
        let body = build_payload(&req, false);
        let resp = self
            .client
            .post(format!("{}/api/chat", self.base_url))
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(AgentError::Provider(format!("status {status}: {text}")));
        }
        let env: ChatResponse = serde_json::from_str(&text)?;
        Ok(CompletionResponse {
            content: env.message.map(|m| m.content).unwrap_or_default(),
            model: env.model,
            finish_reason: env.done_reason,
            usage: Some(TokenUsage {
                input_tokens: env.prompt_eval_count.unwrap_or(0),
                output_tokens: env.eval_count.unwrap_or(0),
            }),
        })
    }

    fn stream(&self, req: CompletionRequest) -> StreamResult {
        let client = self.client.clone();
        let url = format!("{}/api/chat", self.base_url);

        let stream = async_stream::try_stream! {
            let body = build_payload(&req, true);
            let resp = client.post(&url).json(&body).send().await?;
            let status = resp.status();
            let resp = if status.is_success() {
                resp
            } else {
                let text = resp.text().await.unwrap_or_default();
                Err::<reqwest::Response, _>(AgentError::Provider(format!("status {status}: {text}")))?;
                unreachable!()
            };

            let bytes = resp.bytes_stream().map(|r| r.map_err(std::io::Error::other));
            let reader = StreamReader::new(bytes);
            let mut lines = reader.lines();
            let mut finish_reason: Option<String> = None;
            let mut usage: Option<TokenUsage> = None;

            while let Some(line) = lines.next_line().await.map_err(|e| AgentError::Provider(format!("ollama read: {e}")))? {
                if line.trim().is_empty() { continue; }
                match serde_json::from_str::<ChatResponse>(&line) {
                    Ok(chunk) => {
                        if let Some(msg) = chunk.message {
                            if !msg.content.is_empty() {
                                yield StreamEvent::Delta { text: msg.content };
                            }
                        }
                        if chunk.done {
                            finish_reason = chunk.done_reason;
                            usage = Some(TokenUsage {
                                input_tokens: chunk.prompt_eval_count.unwrap_or(0),
                                output_tokens: chunk.eval_count.unwrap_or(0),
                            });
                            break;
                        }
                    }
                    Err(e) => {
                        yield StreamEvent::Warning { message: format!("ollama parse: {e}") };
                    }
                }
            }

            yield StreamEvent::Done { finish_reason, usage };
        };

        Box::pin(stream)
    }
}
