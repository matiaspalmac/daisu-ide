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
    StreamResult, TokenUsage, ToolCall, ToolCapability, ToolChoice,
};
use crate::error::{AgentError, AgentResult};
use std::collections::HashMap;

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
            match m.role {
                Role::Tool => {
                    let id = m.tool_call_id.clone().unwrap_or_default();
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": id,
                        "content": m.content,
                    }));
                }
                Role::Assistant => {
                    let mut entry = json!({ "role": "assistant", "content": m.content });
                    if let Some(calls) = m.tool_calls.as_ref() {
                        if !calls.is_empty() {
                            let arr: Vec<serde_json::Value> = calls
                                .iter()
                                .map(|c| {
                                    json!({
                                        "id": c.id,
                                        "type": "function",
                                        "function": {
                                            "name": c.name,
                                            "arguments": serde_json::to_string(&c.arguments)
                                                .unwrap_or_else(|_| "{}".into()),
                                        }
                                    })
                                })
                                .collect();
                            entry["tool_calls"] = json!(arr);
                        }
                    }
                    messages.push(entry);
                }
                Role::User => {
                    messages.push(json!({ "role": "user", "content": m.content }));
                }
                Role::System => {
                    messages.push(json!({ "role": "system", "content": m.content }));
                }
            }
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
        if !req.tools.is_empty() {
            // Standard OpenAI Chat Completions tool schema (nested
            // `function` wrapper, unlike Responses API).
            let tools: Vec<serde_json::Value> = req
                .tools
                .iter()
                .map(|t| {
                    let mut fun = json!({
                        "name": t.name,
                        "parameters": t.input_schema,
                    });
                    if let Some(d) = t.description.as_deref() {
                        fun["description"] = json!(d);
                    }
                    json!({ "type": "function", "function": fun })
                })
                .collect();
            body["tools"] = json!(tools);
            if let Some(choice) = req.tool_choice {
                body["tool_choice"] = match choice {
                    ToolChoice::Auto => json!("auto"),
                    ToolChoice::Required => json!("required"),
                    ToolChoice::None => json!("none"),
                };
            }
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
    #[serde(default)]
    tool_calls: Vec<OaiToolCall>,
}

#[derive(Debug, Deserialize, Clone)]
struct OaiToolCall {
    #[serde(default)]
    id: String,
    function: OaiFunction,
}

#[derive(Debug, Deserialize, Clone)]
struct OaiFunction {
    name: String,
    #[serde(default)]
    arguments: String,
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
    #[serde(default)]
    tool_calls: Vec<DeltaToolCall>,
}

#[derive(Debug, Deserialize, Default)]
struct DeltaToolCall {
    /// Index of this tool call within the assistant turn. Multiple
    /// chunks share the same index for the same call; we accumulate
    /// `function.name` + `function.arguments` per index.
    #[serde(default)]
    index: u32,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: Option<DeltaFunction>,
}

#[derive(Debug, Deserialize, Default)]
struct DeltaFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
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

/// Drops embedding / tts / whisper / etc. ids from the catalog. Local
/// LM Studio installs commonly load both a chat model and an embedding
/// model, both of which appear in `/v1/models`.
fn is_non_chat_model(id: &str) -> bool {
    const DENY: &[&str] = &[
        "embedding",
        "embed",
        "tts",
        "whisper",
        "moderation",
        "rerank",
        "clip",
    ];
    let lower = id.to_ascii_lowercase();
    DENY.iter().any(|needle| lower.contains(needle))
}

#[async_trait]
impl LlmProvider for LmStudioProvider {
    fn id(&self) -> ProviderId {
        ProviderId::LmStudio
    }

    fn name(&self) -> &str {
        ProviderId::LmStudio.display_name()
    }

    fn supported_tools(&self) -> ToolCapability {
        ProviderId::LmStudio.capabilities()
    }

    fn default_model(&self) -> &str {
        // LM Studio has no static default — the catalog depends on what
        // the user has loaded. The empty string signals "fall back to
        // the first listed model" to callers like agent_provider_test.
        ProviderId::LmStudio.default_model()
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
            // Skip non-chat models (LM Studio exposes loaded embedding
            // models alongside chat models on /v1/models). Reuses the
            // OpenAI deny-list since LM Studio mirrors the same wire
            // schema and naming conventions.
            .filter(|m| !is_non_chat_model(&m.id))
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
        let (content, finish, tool_calls) = first.map_or((String::new(), None, Vec::new()), |c| {
            let calls: Vec<ToolCall> = c
                .message
                .tool_calls
                .into_iter()
                .enumerate()
                .map(|(i, tc)| {
                    let args: serde_json::Value = if tc.function.arguments.trim().is_empty() {
                        json!({})
                    } else {
                        serde_json::from_str(&tc.function.arguments).unwrap_or_else(|_| json!({}))
                    };
                    ToolCall {
                        // LM Studio echoes ids when the model emits them;
                        // some local models don't, so synthesize a stable
                        // fallback to keep the runtime correlation safe.
                        id: if tc.id.is_empty() {
                            format!("lms-{i}")
                        } else {
                            tc.id
                        },
                        name: tc.function.name,
                        arguments: args,
                    }
                })
                .collect();
            (
                c.message.content.unwrap_or_default(),
                c.finish_reason,
                calls,
            )
        });
        Ok(CompletionResponse {
            content,
            model: env.model,
            finish_reason: finish,
            usage: env.usage.map(|u| TokenUsage {
                input_tokens: u.prompt_tokens,
                output_tokens: u.completion_tokens,
            }),
            tool_calls,
        })
    }

    #[allow(clippy::too_many_lines)]
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
            let mut usage: Option<TokenUsage> = None;
            // Per-index tool_call accumulator. OpenAI Chat Completions
            // streams tool calls as a sequence of `delta.tool_calls`
            // chunks where each chunk supplies *part* of one or more
            // calls — first chunk has the id+name, later chunks append
            // to `function.arguments` (a string). We emit
            // ToolUseStart/ArgsDelta as we go and ToolUseDone at the
            // end-of-stream signal.
            struct PendingFn {
                id: String,
                name: String,
                args_json: String,
                emitted_start: bool,
            }
            let mut pending: HashMap<u32, PendingFn> = HashMap::new();
            let mut emit_order: Vec<u32> = Vec::new();

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
                            for tc in choice.delta.tool_calls {
                                let idx = tc.index;
                                let entry = pending.entry(idx).or_insert_with(|| {
                                    emit_order.push(idx);
                                    PendingFn {
                                        id: String::new(),
                                        name: String::new(),
                                        args_json: String::new(),
                                        emitted_start: false,
                                    }
                                });
                                if let Some(id) = tc.id {
                                    if !id.is_empty() {
                                        entry.id = id;
                                    }
                                }
                                if let Some(f) = tc.function {
                                    if let Some(n) = f.name {
                                        if !n.is_empty() {
                                            entry.name = n;
                                        }
                                    }
                                    if let Some(a) = f.arguments {
                                        entry.args_json.push_str(&a);
                                        if entry.emitted_start {
                                            yield StreamEvent::ToolUseArgsDelta {
                                                id: entry.id.clone(),
                                                fragment: a,
                                            };
                                        }
                                    }
                                }
                                // Emit Start once we have id+name. Some
                                // models stream id and name in the first
                                // chunk; others trickle them in.
                                if !entry.emitted_start && !entry.name.is_empty() {
                                    if entry.id.is_empty() {
                                        entry.id = format!("lms-{idx}");
                                    }
                                    yield StreamEvent::ToolUseStart {
                                        id: entry.id.clone(),
                                        name: entry.name.clone(),
                                    };
                                    entry.emitted_start = true;
                                    if !entry.args_json.is_empty() {
                                        yield StreamEvent::ToolUseArgsDelta {
                                            id: entry.id.clone(),
                                            fragment: entry.args_json.clone(),
                                        };
                                    }
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

            // Finalise pending tool calls: parse args, emit Done events,
            // assemble the final ToolCall vec in stream order.
            let mut tool_calls: Vec<ToolCall> = Vec::new();
            for idx in emit_order {
                if let Some(p) = pending.remove(&idx) {
                    if p.name.is_empty() { continue; }
                    let parsed: serde_json::Value = if p.args_json.trim().is_empty() {
                        json!({})
                    } else {
                        serde_json::from_str(&p.args_json).unwrap_or_else(|_| json!({}))
                    };
                    let id = if p.id.is_empty() {
                        format!("lms-{idx}")
                    } else {
                        p.id
                    };
                    yield StreamEvent::ToolUseDone { id: id.clone() };
                    tool_calls.push(ToolCall {
                        id,
                        name: p.name,
                        arguments: parsed,
                    });
                }
            }

            yield StreamEvent::Done { finish_reason, usage, tool_calls };
        };

        Box::pin(stream)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deny_filter_drops_embedding_models() {
        assert!(is_non_chat_model("nomic-embed-text-v1.5"));
        assert!(is_non_chat_model("text-embedding-nomic"));
        assert!(is_non_chat_model("whisper-large-v3"));
        assert!(is_non_chat_model("clip-vit-base-patch32"));
        assert!(is_non_chat_model("bge-reranker-base"));
    }

    #[test]
    fn deny_filter_keeps_chat_models() {
        assert!(!is_non_chat_model("qwen2.5-coder-7b-instruct"));
        assert!(!is_non_chat_model("llama-3.2-3b-instruct"));
        assert!(!is_non_chat_model("mistral-nemo-instruct-2407"));
    }

    #[test]
    fn chat_chunk_decodes_delta_content() {
        let raw =
            r#"{"choices":[{"delta":{"content":"hello"},"finish_reason":null}],"usage":null}"#;
        let chunk: ChatChunk = serde_json::from_str(raw).unwrap();
        assert_eq!(chunk.choices.len(), 1);
        assert_eq!(chunk.choices[0].delta.content.as_deref(), Some("hello"));
    }

    #[test]
    fn delta_tool_calls_decode_per_index() {
        let raw = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"read_file","arguments":"{\"path\":\""}}]},"finish_reason":null}]}"#;
        let chunk: ChatChunk = serde_json::from_str(raw).unwrap();
        let tcs = &chunk.choices[0].delta.tool_calls;
        assert_eq!(tcs.len(), 1);
        assert_eq!(tcs[0].index, 0);
        assert_eq!(tcs[0].id.as_deref(), Some("call_a"));
        let f = tcs[0].function.as_ref().expect("function");
        assert_eq!(f.name.as_deref(), Some("read_file"));
        assert_eq!(f.arguments.as_deref(), Some(r#"{"path":""#));
    }

    #[test]
    fn second_chunk_appends_argument_fragment() {
        // Real OpenAI Chat Completions streaming sends id+name on the
        // first delta, then arg fragments on subsequent deltas.
        let raw = r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"x.rs\"}"}}]}}]}"#;
        let chunk: ChatChunk = serde_json::from_str(raw).unwrap();
        let f = chunk.choices[0].delta.tool_calls[0]
            .function
            .as_ref()
            .expect("function");
        assert_eq!(f.name, None);
        assert_eq!(f.arguments.as_deref(), Some(r#"x.rs"}"#));
    }

    #[test]
    fn full_message_with_tool_calls_extracts() {
        let raw = r#"{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_a","function":{"name":"read_file","arguments":"{\"path\":\"src/main.rs\"}"}}]},"finish_reason":"tool_calls"}],"model":"qwen2.5-coder","usage":{"prompt_tokens":4,"completion_tokens":3}}"#;
        let env: ChatEnvelope = serde_json::from_str(raw).unwrap();
        let msg = &env.choices[0].message;
        assert_eq!(msg.tool_calls.len(), 1);
        assert_eq!(msg.tool_calls[0].id, "call_a");
        assert_eq!(msg.tool_calls[0].function.name, "read_file");
        assert_eq!(
            msg.tool_calls[0].function.arguments,
            r#"{"path":"src/main.rs"}"#
        );
    }
}
