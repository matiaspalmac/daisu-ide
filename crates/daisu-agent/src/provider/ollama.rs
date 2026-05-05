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
    StreamResult, TokenUsage, ToolCall, ToolCapability,
};
use crate::error::{AgentError, AgentResult};
use serde_json::Value;

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
struct ChatRequest {
    model: String,
    messages: Vec<Value>,
    stream: bool,
    options: Options,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<Value>,
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
    #[serde(default)]
    content: String,
    /// Ollama returns tool calls only when the model supports tools and
    /// the request included a `tools` field. Args is an object, not a
    /// JSON string (different from OpenAI). Calls usually arrive on the
    /// final `done:true` chunk.
    #[serde(default)]
    tool_calls: Vec<OllamaToolCall>,
}

#[derive(Debug, Deserialize)]
struct OllamaToolCall {
    function: OllamaFunction,
}

#[derive(Debug, Deserialize)]
struct OllamaFunction {
    name: String,
    #[serde(default)]
    arguments: Value,
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
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::Tool => "tool",
    }
}

fn message_to_json(m: &super::Message) -> Value {
    let mut v = serde_json::json!({
        "role": role_str(m.role),
        "content": m.content,
    });
    // Ollama assistant turns can include tool_calls in the OpenAI-shaped
    // form: [{function:{name,arguments:Object}}].
    if matches!(m.role, Role::Assistant) {
        if let Some(calls) = m.tool_calls.as_ref() {
            if !calls.is_empty() {
                let arr: Vec<Value> = calls
                    .iter()
                    .map(|c| {
                        serde_json::json!({
                            "function": {
                                "name": c.name,
                                "arguments": c.arguments,
                            }
                        })
                    })
                    .collect();
                v["tool_calls"] = Value::Array(arr);
            }
        }
    }
    // Tool results carry tool_name when the upstream message tracked a
    // tool_call_id back to its function name. Ollama uses the function
    // name as the link rather than an opaque id.
    if matches!(m.role, Role::Tool) {
        if let Some(id) = m.tool_call_id.as_deref() {
            v["tool_name"] = Value::String(id.to_string());
        }
    }
    v
}

fn build_payload(req: &CompletionRequest, stream: bool) -> ChatRequest {
    let mut messages: Vec<Value> = Vec::with_capacity(req.messages.len() + 1);
    if let Some(sys) = req.system.as_deref() {
        messages.push(serde_json::json!({
            "role": "system",
            "content": sys,
        }));
    }
    let _ = stream; // shut up unused var; we still pass below
    for m in &req.messages {
        // Old loop body uses m to build ChatMessage; we replace with JSON.
        let _ = m;
        messages.push(message_to_json(m));
    }
    let tools: Vec<Value> = req
        .tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description.clone().unwrap_or_default(),
                    "parameters": t.input_schema,
                }
            })
        })
        .collect();
    ChatRequest {
        model: req.model.clone(),
        messages,
        stream,
        options: Options {
            temperature: req.temperature,
            num_predict: Some(req.max_tokens),
        },
        tools,
    }
}

#[async_trait]
impl LlmProvider for OllamaProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Ollama
    }

    fn name(&self) -> &str {
        ProviderId::Ollama.display_name()
    }

    fn supported_tools(&self) -> ToolCapability {
        ProviderId::Ollama.capabilities()
    }

    fn default_model(&self) -> &str {
        ProviderId::Ollama.default_model()
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
                    // Ollama exposes tool calling on capable models
                    // (qwen3-coder, llama3.1+, mistral-nemo, command-r).
                    // We can't tell from /api/tags which support tools
                    // without an extra /api/show probe, so default
                    // optimistic and let the runtime degrade if a model
                    // rejects the `tools` field.
                    supports_tools: true,
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
        let (content, tool_calls) = if let Some(msg) = env.message {
            let calls: Vec<ToolCall> = msg
                .tool_calls
                .into_iter()
                .enumerate()
                .map(|(i, c)| ToolCall {
                    // Ollama doesn't issue ids; synthesize a stable one
                    // per turn so the runtime can correlate results.
                    id: format!("ollama-{i}"),
                    name: c.function.name,
                    arguments: c.function.arguments,
                })
                .collect();
            (msg.content, calls)
        } else {
            (String::new(), Vec::new())
        };
        Ok(CompletionResponse {
            content,
            model: env.model,
            finish_reason: env.done_reason,
            usage: Some(TokenUsage {
                input_tokens: env.prompt_eval_count.unwrap_or(0),
                output_tokens: env.eval_count.unwrap_or(0),
            }),
            tool_calls,
        })
    }

    fn stream(&self, req: CompletionRequest) -> StreamResult {
        let client = self.client.clone();
        let url = format!("{}/api/chat", self.base_url);

        let stream = async_stream::try_stream! {
            let body = build_payload(&req, true);
            let resp = client.post(&url).json(&body).send().await?;
            let status = resp.status();
            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                Err::<(), _>(AgentError::Provider(format!("status {status}: {text}")))?;
                return;
            }

            let bytes = resp.bytes_stream().map(|r| r.map_err(std::io::Error::other));
            let reader = StreamReader::new(bytes);
            let mut lines = reader.lines();
            let mut finish_reason: Option<String> = None;
            let mut usage: Option<TokenUsage> = None;
            let mut collected_tool_calls: Vec<ToolCall> = Vec::new();

            while let Some(line) = lines.next_line().await.map_err(|e| AgentError::Provider(format!("ollama read: {e}")))? {
                if line.trim().is_empty() { continue; }
                match serde_json::from_str::<ChatResponse>(&line) {
                    Ok(chunk) => {
                        if let Some(msg) = chunk.message {
                            if !msg.content.is_empty() {
                                yield StreamEvent::Delta { text: msg.content };
                            }
                            // Tool calls usually arrive as a complete
                            // batch on the final `done:true` chunk, but
                            // newer Ollama can stream them progressively.
                            // Either way we get a fully-formed object.
                            for (i, c) in msg.tool_calls.into_iter().enumerate() {
                                let id = format!("ollama-{}-{}", collected_tool_calls.len() + i, c.function.name);
                                let args_json = serde_json::to_string(&c.function.arguments)
                                    .unwrap_or_else(|_| "{}".into());
                                yield StreamEvent::ToolUseStart {
                                    id: id.clone(),
                                    name: c.function.name.clone(),
                                };
                                yield StreamEvent::ToolUseArgsDelta {
                                    id: id.clone(),
                                    fragment: args_json,
                                };
                                yield StreamEvent::ToolUseDone { id: id.clone() };
                                collected_tool_calls.push(ToolCall {
                                    id,
                                    name: c.function.name,
                                    arguments: c.function.arguments,
                                });
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

            yield StreamEvent::Done { finish_reason, usage, tool_calls: collected_tool_calls };
        };

        Box::pin(stream)
    }
}
