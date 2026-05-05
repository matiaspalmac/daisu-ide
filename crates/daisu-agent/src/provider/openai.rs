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
    StreamResult, TokenUsage, ToolCall, ToolCapability, ToolChoice,
};
use crate::error::{AgentError, AgentResult};
use std::collections::HashMap;

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
        // The Responses API uses `instructions` for the system prompt
        // and `input` as a list of typed items. Three item shapes
        // matter for tool-calling:
        //   - { type:"message", role, content:[{type, text}] }       — text turns
        //   - { type:"function_call", call_id, name, arguments }     — assistant tool call
        //   - { type:"function_call_output", call_id, output }       — tool result
        let instructions = req.system.clone().or_else(|| {
            req.messages
                .iter()
                .find(|m| matches!(m.role, Role::System))
                .map(|m| m.content.clone())
        });

        let mut input: Vec<serde_json::Value> = Vec::with_capacity(req.messages.len());
        for m in req
            .messages
            .iter()
            .filter(|m| !matches!(m.role, Role::System))
        {
            match m.role {
                Role::Tool => {
                    // Tool result message — links via tool_call_id.
                    let call_id = m.tool_call_id.clone().unwrap_or_default();
                    input.push(json!({
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": m.content,
                    }));
                }
                Role::Assistant => {
                    if !m.content.is_empty() {
                        input.push(json!({
                            "type": "message",
                            "role": "assistant",
                            "content": [{ "type": "output_text", "text": m.content }],
                        }));
                    }
                    if let Some(calls) = m.tool_calls.as_ref() {
                        for c in calls {
                            input.push(json!({
                                "type": "function_call",
                                "call_id": c.id,
                                "name": c.name,
                                "arguments": serde_json::to_string(&c.arguments)
                                    .unwrap_or_else(|_| "{}".into()),
                            }));
                        }
                    }
                }
                Role::User => {
                    input.push(json!({
                        "type": "message",
                        "role": "user",
                        "content": [{ "type": "input_text", "text": m.content }],
                    }));
                }
                Role::System => unreachable!(),
            }
        }

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
        if !req.tools.is_empty() {
            // Responses API uses a flat tool schema (no nested
            // `function` wrapper that Chat Completions requires).
            let tools: Vec<serde_json::Value> = req
                .tools
                .iter()
                .map(|t| {
                    let mut v = json!({
                        "type": "function",
                        "name": t.name,
                        "parameters": t.input_schema,
                    });
                    if let Some(d) = t.description.as_deref() {
                        v["description"] = json!(d);
                    }
                    v
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
    /// Tool call in non-streaming responses. `call_id` round-trips back
    /// as the answering tool message's reference.
    FunctionCall {
        call_id: String,
        name: String,
        #[serde(default)]
        arguments: String,
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
#[serde(tag = "type")]
enum SseEvent {
    #[serde(rename = "response.output_text.delta")]
    OutputTextDelta { delta: String },
    /// New output item begins (text message OR function_call). For
    /// function_call we capture call_id + name; arguments stream via
    /// later `response.function_call_arguments.delta` events keyed by
    /// `item_id`.
    #[serde(rename = "response.output_item.added")]
    OutputItemAdded {
        #[serde(default)]
        output_index: u32,
        item: OutputItemAddedPayload,
    },
    #[serde(rename = "response.function_call_arguments.delta")]
    FunctionArgsDelta {
        #[serde(default)]
        #[allow(dead_code)]
        item_id: String,
        #[serde(default)]
        output_index: u32,
        delta: String,
    },
    #[serde(rename = "response.function_call_arguments.done")]
    FunctionArgsDone {
        #[serde(default)]
        #[allow(dead_code)]
        item_id: String,
        #[serde(default)]
        output_index: u32,
        #[serde(default)]
        arguments: String,
    },
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
#[serde(tag = "type", rename_all = "snake_case")]
enum OutputItemAddedPayload {
    FunctionCall {
        #[serde(default)]
        #[allow(dead_code)]
        id: String,
        #[serde(default)]
        call_id: String,
        name: String,
    },
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

/// Returns true if a model id matches one of the well-known non-chat
/// capabilities OpenAI exposes through `/v1/models`. Used as a deny
/// filter so newly-released chat / reasoning models pass through
/// without code changes.
fn is_non_chat_model(id: &str) -> bool {
    const DENY: &[&str] = &[
        "embedding",
        "tts",
        "whisper",
        "dall-e",
        "image",
        "moderation",
        "realtime",
        "audio",
        "transcribe",
        "babbage",
        "davinci",
    ];
    let lower = id.to_ascii_lowercase();
    DENY.iter().any(|needle| lower.contains(needle))
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn id(&self) -> ProviderId {
        ProviderId::OpenAi
    }

    fn name(&self) -> &str {
        ProviderId::OpenAi.display_name()
    }

    fn supported_tools(&self) -> ToolCapability {
        ProviderId::OpenAi.capabilities()
    }

    fn default_model(&self) -> &str {
        ProviderId::OpenAi.default_model()
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
            // Reject by capability instead of by allow-listing prefixes.
            // The allow-list ages with every release: when OpenAI ships
            // a new model family (codex, sora, future "o5"), an
            // allow-list silently hides it from the catalog. The
            // deny-list only filters non-chat capabilities, which are
            // a stable, finite set.
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
        let mut content = String::new();
        let mut tool_calls: Vec<ToolCall> = Vec::new();
        for item in env.output {
            match item {
                OutputItem::Message { content: parts } => {
                    for c in parts {
                        if let OutputContent::OutputText { text } = c {
                            content.push_str(&text);
                        }
                    }
                }
                OutputItem::FunctionCall {
                    call_id,
                    name,
                    arguments,
                } => {
                    let args: serde_json::Value = if arguments.trim().is_empty() {
                        json!({})
                    } else {
                        serde_json::from_str(&arguments).unwrap_or_else(|_| json!({}))
                    };
                    tool_calls.push(ToolCall {
                        id: call_id,
                        name,
                        arguments: args,
                    });
                }
                OutputItem::Other => {}
            }
        }

        Ok(CompletionResponse {
            content,
            model: env.model,
            finish_reason: env.status,
            usage: env.usage.map(|u| TokenUsage {
                input_tokens: u.input_tokens,
                output_tokens: u.output_tokens,
            }),
            tool_calls,
        })
    }

    #[allow(clippy::too_many_lines)]
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
            // Tracking by output_index because the OpenAI SSE stream
            // identifies tool-call argument deltas by index alongside
            // the (sometimes-absent) item_id. We keep both keys for
            // robustness — whichever the server uses, we resolve.
            struct PendingFn {
                call_id: String,
                name: String,
                args_json: String,
            }
            let mut pending: HashMap<u32, PendingFn> = HashMap::new();
            let mut emit_order: Vec<u32> = Vec::new();
            // Completed calls keyed by output_index — preserves the
            // server's emission order even when ArgsDone events arrive
            // interleaved across multiple parallel tool calls.
            let mut completed: HashMap<u32, ToolCall> = HashMap::new();

            while let Some(event) = events.next().await {
                let event = event.map_err(|e| AgentError::Provider(format!("sse: {e}")))?;
                if event.data.is_empty() || event.data == "[DONE]" { continue; }
                match serde_json::from_str::<SseEvent>(&event.data) {
                    Ok(SseEvent::OutputTextDelta { delta }) => {
                        yield StreamEvent::Delta { text: delta };
                    }
                    Ok(SseEvent::OutputItemAdded { output_index, item }) => {
                        if let OutputItemAddedPayload::FunctionCall { call_id, name, .. } = item {
                            emit_order.push(output_index);
                            pending.insert(output_index, PendingFn {
                                call_id: call_id.clone(),
                                name: name.clone(),
                                args_json: String::new(),
                            });
                            yield StreamEvent::ToolUseStart { id: call_id, name };
                        }
                    }
                    Ok(SseEvent::FunctionArgsDelta { output_index, delta, .. }) => {
                        if let Some(p) = pending.get_mut(&output_index) {
                            p.args_json.push_str(&delta);
                            let id = p.call_id.clone();
                            yield StreamEvent::ToolUseArgsDelta { id, fragment: delta };
                        }
                    }
                    Ok(SseEvent::FunctionArgsDone { output_index, arguments, .. }) => {
                        if let Some(mut p) = pending.remove(&output_index) {
                            // Final consolidated args ship in this event;
                            // prefer them over the streamed accumulation
                            // (the server does the same parse).
                            if !arguments.is_empty() {
                                p.args_json = arguments;
                            }
                            let parsed: serde_json::Value = if p.args_json.trim().is_empty() {
                                json!({})
                            } else {
                                serde_json::from_str(&p.args_json).unwrap_or_else(|_| json!({}))
                            };
                            let id = p.call_id.clone();
                            completed.insert(output_index, ToolCall {
                                id: id.clone(),
                                name: p.name,
                                arguments: parsed,
                            });
                            yield StreamEvent::ToolUseDone { id };
                        }
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
                            || format!("openai response failed: {}", event.data),
                            |e| e.message,
                        );
                        Err::<(), _>(AgentError::Provider(msg))?;
                        return;
                    }
                    Ok(SseEvent::Error { message }) => {
                        Err::<(), _>(AgentError::Provider(message))?;
                        return;
                    }
                    Ok(SseEvent::Other) => {}
                    Err(e) => {
                        yield StreamEvent::Warning { message: format!("parse: {e}") };
                    }
                }
            }

            // Drain in server emission order. `emit_order` was populated
            // from output_item.added events, so this preserves the
            // order the model returned regardless of which call's
            // arguments finished streaming first.
            let ordered_calls: Vec<ToolCall> = emit_order
                .into_iter()
                .filter_map(|idx| completed.remove(&idx))
                .collect();

            yield StreamEvent::Done {
                finish_reason,
                usage,
                tool_calls: ordered_calls,
            };
        };

        Box::pin(stream)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deny_filter_drops_non_chat_models() {
        assert!(is_non_chat_model("text-embedding-3-small"));
        assert!(is_non_chat_model("whisper-1"));
        assert!(is_non_chat_model("tts-1-hd"));
        assert!(is_non_chat_model("dall-e-3"));
        assert!(is_non_chat_model("text-moderation-latest"));
        assert!(is_non_chat_model("gpt-4o-realtime-preview-2024-12-17"));
        assert!(is_non_chat_model("gpt-4o-audio-preview"));
    }

    #[test]
    fn deny_filter_keeps_chat_and_reasoning_models() {
        assert!(!is_non_chat_model("gpt-5.5"));
        assert!(!is_non_chat_model("gpt-5.3-codex"));
        assert!(!is_non_chat_model("o3"));
        assert!(!is_non_chat_model("o3-pro"));
        assert!(!is_non_chat_model("chatgpt-4o-latest"));
        // Hypothetical future model with no familiar prefix should pass
        // through — that's the whole point of switching to a deny list.
        assert!(!is_non_chat_model("foo-bar-baz-2027"));
    }

    #[test]
    fn failed_event_with_null_error_falls_back_to_raw_data() {
        // Regression: previously yielded "openai: response failed" with
        // no diagnostic when response.error was null.
        let raw = r#"{"type":"response.failed","response":{"error":null}}"#;
        let parsed: SseEvent = serde_json::from_str(raw).unwrap();
        match parsed {
            SseEvent::Failed { response } => {
                assert!(response.error.is_none());
            }
            _ => panic!("expected Failed variant"),
        }
    }

    #[test]
    fn typed_sse_events_round_trip() {
        let delta: SseEvent =
            serde_json::from_str(r#"{"type":"response.output_text.delta","delta":"hello"}"#)
                .unwrap();
        assert!(matches!(delta, SseEvent::OutputTextDelta { ref delta } if delta == "hello"));

        let completed: SseEvent = serde_json::from_str(
            r#"{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":20}}}"#,
        )
        .unwrap();
        match completed {
            SseEvent::Completed { response } => {
                assert_eq!(response.status.as_deref(), Some("completed"));
                let u = response.usage.expect("usage");
                assert_eq!(u.input_tokens, 10);
                assert_eq!(u.output_tokens, 20);
            }
            _ => panic!("expected Completed"),
        }
    }

    #[test]
    fn output_item_added_decodes_function_call() {
        let raw = r#"{"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc_a","call_id":"call_a","name":"read_file"}}"#;
        let parsed: SseEvent = serde_json::from_str(raw).unwrap();
        match parsed {
            SseEvent::OutputItemAdded {
                output_index,
                item: OutputItemAddedPayload::FunctionCall { call_id, name, .. },
            } => {
                assert_eq!(output_index, 1);
                assert_eq!(call_id, "call_a");
                assert_eq!(name, "read_file");
            }
            _ => panic!("expected OutputItemAdded::FunctionCall"),
        }
    }

    #[test]
    fn function_args_delta_carries_fragment() {
        let raw = r#"{"type":"response.function_call_arguments.delta","item_id":"fc_a","output_index":1,"delta":"{\"path\":\"x\"}"}"#;
        let parsed: SseEvent = serde_json::from_str(raw).unwrap();
        match parsed {
            SseEvent::FunctionArgsDelta {
                output_index,
                delta,
                ..
            } => {
                assert_eq!(output_index, 1);
                assert_eq!(delta, r#"{"path":"x"}"#);
            }
            _ => panic!("expected FunctionArgsDelta"),
        }
    }

    #[test]
    fn function_args_done_carries_full_arguments() {
        let raw = r#"{"type":"response.function_call_arguments.done","item_id":"fc_a","output_index":1,"arguments":"{\"path\":\"src/main.rs\"}"}"#;
        let parsed: SseEvent = serde_json::from_str(raw).unwrap();
        match parsed {
            SseEvent::FunctionArgsDone {
                output_index,
                arguments,
                ..
            } => {
                assert_eq!(output_index, 1);
                assert_eq!(arguments, r#"{"path":"src/main.rs"}"#);
            }
            _ => panic!("expected FunctionArgsDone"),
        }
    }

    #[test]
    fn non_streaming_response_extracts_function_call_with_args() {
        let raw = r#"{"output":[{"type":"function_call","call_id":"call_x","name":"list_dir","arguments":"{\"path\":\".\"}"}],"model":"gpt-5.5","status":"completed","usage":{"input_tokens":5,"output_tokens":2}}"#;
        let env: ResponsesEnvelope = serde_json::from_str(raw).unwrap();
        match &env.output[0] {
            OutputItem::FunctionCall {
                call_id,
                name,
                arguments,
            } => {
                assert_eq!(call_id, "call_x");
                assert_eq!(name, "list_dir");
                assert_eq!(arguments, r#"{"path":"."}"#);
            }
            _ => panic!("expected FunctionCall"),
        }
    }
}
