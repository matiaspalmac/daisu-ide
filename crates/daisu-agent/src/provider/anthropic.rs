//! Anthropic Claude provider — `/v1/messages` with full tool support.
//!
//! Uses the `2023-06-01` API version. Tool calling rides on the
//! standard message schema: assistant turns can contain `tool_use`
//! content blocks; tool results come back from the runtime as `user`
//! messages whose `content` is a list of `tool_result` blocks.

use std::collections::HashMap;
use std::time::Duration;

use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures::stream::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    CompletionRequest, CompletionResponse, LlmProvider, Message, ModelInfo, ProviderId, Role,
    StreamEvent, StreamResult, TokenUsage, ToolCall, ToolCapability, ToolChoice,
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

    /// Translate a single agent-side `Message` into the Anthropic
    /// content-block schema.
    fn message_to_blocks(m: &Message) -> Value {
        match m.role {
            Role::Tool => {
                // Anthropic returns tool results as a user message
                // whose content is a list of `tool_result` blocks. The
                // id round-trips back via tool_use_id.
                let id = m.tool_call_id.clone().unwrap_or_default();
                json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": id,
                        "content": m.content,
                    }],
                })
            }
            Role::Assistant => {
                let mut blocks: Vec<Value> = Vec::new();
                if !m.content.is_empty() {
                    blocks.push(json!({ "type": "text", "text": m.content }));
                }
                if let Some(calls) = m.tool_calls.as_ref() {
                    for c in calls {
                        blocks.push(json!({
                            "type": "tool_use",
                            "id": c.id,
                            "name": c.name,
                            "input": c.arguments,
                        }));
                    }
                }
                if blocks.is_empty() {
                    // Anthropic rejects empty content; preserve a marker.
                    blocks.push(json!({ "type": "text", "text": "" }));
                }
                json!({ "role": "assistant", "content": blocks })
            }
            Role::User => json!({
                "role": "user",
                "content": m.content,
            }),
            Role::System => unreachable!("system filtered upstream"),
        }
    }

    fn build_body(req: &CompletionRequest, stream: bool) -> Value {
        let messages: Vec<Value> = req
            .messages
            .iter()
            .filter(|m| !matches!(m.role, Role::System))
            .map(Self::message_to_blocks)
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
        if !req.tools.is_empty() {
            let tools: Vec<Value> = req
                .tools
                .iter()
                .map(|t| {
                    let mut v = json!({
                        "name": t.name,
                        "input_schema": t.input_schema,
                    });
                    if let Some(d) = t.description.as_deref() {
                        v["description"] = json!(d);
                    }
                    // Anthropic strict tool use compiles input_schema into
                    // a grammar at sample time. Caveats: schema must not
                    // use top-level oneOf/allOf/anyOf and must declare
                    // additionalProperties: false on every object.
                    if t.strict {
                        v["strict"] = json!(true);
                    }
                    v
                })
                .collect();
            body["tools"] = json!(tools);
            if let Some(choice) = req.tool_choice {
                body["tool_choice"] = match choice {
                    ToolChoice::Auto => json!({ "type": "auto" }),
                    ToolChoice::Required => json!({ "type": "any" }),
                    ToolChoice::None => json!({ "type": "none" }),
                };
            }
        }
        Self::apply_cache_breakpoints(&mut body, &req.model);
        body
    }

    /// Place ephemeral prompt-cache breakpoints. Continue.dev's "optimized"
    /// strategy: cache the system prompt, the last tool definition, and
    /// the last two user/tool-result messages. Uses 4 breakpoints (the
    /// max). Skipped when the model is below the per-model min-token
    /// threshold (Sonnet 4.6 = 2048; Opus 4.7 / Haiku 4.5 = 4096) — the
    /// API silently rejects breakpoints under threshold and we eat a
    /// pointless write. Hits cost 10% of base; 5-min writes 1.25× — the
    /// break-even is ~2 reuses, so it's a near-pure win on any chat that
    /// produces a follow-up turn.
    fn apply_cache_breakpoints(body: &mut Value, model: &str) {
        let min_for_model: u32 = if model.contains("opus") || model.contains("haiku-4") {
            4096
        } else {
            2048
        };
        // Cheap proxy: char count / 4 for a BPE estimate. We'd rather
        // skip a marginal cache than hit the API rejection path.
        let estimate_tokens = |v: &Value| -> u32 {
            #[allow(clippy::cast_possible_truncation)]
            let bytes = serde_json::to_string(v).map_or(0, |s| s.len());
            (bytes / 4) as u32
        };
        let stable_payload_tokens = estimate_tokens(&body["system"])
            + estimate_tokens(body.get("tools").unwrap_or(&Value::Null));
        if stable_payload_tokens < min_for_model {
            return;
        }

        let mut budget = 4u8;

        // (a) system: convert string to [{type: "text", text, cache_control}]
        if let Some(sys) = body.get("system").and_then(Value::as_str) {
            let sys_owned = sys.to_string();
            body["system"] = json!([{
                "type": "text",
                "text": sys_owned,
                "cache_control": { "type": "ephemeral" },
            }]);
            budget = budget.saturating_sub(1);
        }

        // (b) last tool definition: tag with cache_control.
        if budget > 0 {
            if let Some(tools) = body.get_mut("tools").and_then(Value::as_array_mut) {
                if let Some(last) = tools.last_mut() {
                    last["cache_control"] = json!({ "type": "ephemeral" });
                    budget = budget.saturating_sub(1);
                }
            }
        }

        // (c) last 2 messages: anchor mid- and end-of-conversation cache.
        // Wrap string content into a block list so we can attach cache_control.
        if let Some(msgs) = body.get_mut("messages").and_then(Value::as_array_mut) {
            let n = msgs.len();
            for offset in 0..budget.min(2) {
                let Some(i) = n.checked_sub(1 + offset as usize) else {
                    break;
                };
                attach_cache_control_to_message(&mut msgs[i]);
            }
        }
    }
}

/// Best-effort repair of a JSON object truncated mid-emission. Closes
/// any open string + balances braces/brackets so the resulting text
/// parses. Trailing commas inside containers are also stripped. Returns
/// `None` when the input doesn't even start with `{` — a guard against
/// accepting arbitrary garbage as "repaired".
fn repair_truncated_json(raw: &str) -> Option<Value> {
    let trimmed = raw.trim_end();
    if !trimmed.starts_with('{') {
        return None;
    }
    let bytes = trimmed.as_bytes();
    let mut depth_braces: i32 = 0;
    let mut depth_brackets: i32 = 0;
    let mut in_string = false;
    let mut escaped = false;
    for &b in bytes {
        if escaped {
            escaped = false;
            continue;
        }
        if in_string {
            match b {
                b'\\' => escaped = true,
                b'"' => in_string = false,
                _ => {}
            }
        } else {
            match b {
                b'"' => in_string = true,
                b'{' => depth_braces += 1,
                b'}' => depth_braces -= 1,
                b'[' => depth_brackets += 1,
                b']' => depth_brackets -= 1,
                _ => {}
            }
        }
    }
    let mut repaired = trimmed.trim_end_matches(',').to_string();
    if in_string {
        repaired.push('"');
    }
    while depth_brackets > 0 {
        repaired.push(']');
        depth_brackets -= 1;
    }
    while depth_braces > 0 {
        repaired.push('}');
        depth_braces -= 1;
    }
    serde_json::from_str(&repaired).ok()
}

/// Attach `cache_control: ephemeral` to a message's last text block.
/// Wraps a plain `content: String` into a single-element block array if
/// the message wasn't already in block form.
fn attach_cache_control_to_message(m: &mut Value) {
    let Some(obj) = m.as_object_mut() else { return };
    let content = obj.get_mut("content");
    match content {
        Some(Value::String(s)) => {
            let text = std::mem::take(s);
            obj.insert(
                "content".into(),
                json!([{
                    "type": "text",
                    "text": text,
                    "cache_control": { "type": "ephemeral" },
                }]),
            );
        }
        Some(Value::Array(arr)) => {
            if let Some(last) = arr.last_mut() {
                if let Some(block) = last.as_object_mut() {
                    block.insert("cache_control".into(), json!({ "type": "ephemeral" }));
                }
            }
        }
        _ => {}
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
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    #[serde(other)]
    Other,
}

/// See [`super::anthropic`] module docs for why both fields default.
/// Cache fields land here too — Anthropic returns them on every response
/// once any block carries `cache_control`. Both default to 0 when caching
/// is off so reading a cache-less response stays cheap.
///
/// Field names mirror Anthropic's wire format (`input_tokens`,
/// `cache_read_input_tokens`, …) — renaming them would break serde
/// deserialization, so the shared `_tokens` postfix is intentional.
#[allow(clippy::struct_field_names)]
#[derive(Debug, Deserialize, Default, Clone, Copy)]
struct EnvelopeUsage {
    #[serde(default)]
    input_tokens: u32,
    #[serde(default)]
    output_tokens: u32,
    #[serde(default)]
    cache_creation_input_tokens: u32,
    #[serde(default)]
    cache_read_input_tokens: u32,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SseEvent {
    /// First event of every stream — carries the initial usage snapshot
    /// (input_tokens final, output_tokens 0..N).
    MessageStart {
        message: MessageStartPayload,
    },
    /// A new content block is starting. For `tool_use` blocks the
    /// payload carries the final id+name; arguments stream via
    /// subsequent `input_json_delta` events on the matching index.
    ContentBlockStart {
        index: u32,
        content_block: BlockStart,
    },
    ContentBlockDelta {
        index: u32,
        delta: SseDelta,
    },
    ContentBlockStop {
        index: u32,
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
enum BlockStart {
    Text {},
    ToolUse {
        id: String,
        name: String,
        #[serde(default)]
        #[allow(dead_code)]
        input: Option<Value>,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SseDelta {
    TextDelta {
        text: String,
    },
    /// Streaming JSON fragment for an in-flight tool_use block. Append
    /// fragments verbatim and parse at content_block_stop.
    InputJsonDelta {
        partial_json: String,
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

/// Per-block streaming state for in-flight tool_use blocks. Keyed by
/// SSE block index so multiple parallel tool calls in one assistant
/// turn don't get their argument JSON crossed.
struct PendingToolUse {
    id: String,
    name: String,
    args_json: String,
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
        let mut content = String::new();
        let mut tool_calls: Vec<ToolCall> = Vec::new();
        for block in env.content {
            match block {
                ContentBlock::Text { text } => content.push_str(&text),
                ContentBlock::ToolUse { id, name, input } => {
                    tool_calls.push(ToolCall {
                        id,
                        name,
                        arguments: input,
                    });
                }
                ContentBlock::Other => {}
            }
        }

        Ok(CompletionResponse {
            content,
            model: env.model,
            finish_reason: env.stop_reason,
            usage: env.usage.map(|u| TokenUsage {
                input_tokens: u.input_tokens,
                output_tokens: u.output_tokens,
                cache_read_tokens: u.cache_read_input_tokens,
                cache_creation_tokens: u.cache_creation_input_tokens,
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
            let mut input_tokens: u32 = 0;
            let mut output_tokens: u32 = 0;
            let mut cache_read_tokens: u32 = 0;
            let mut cache_creation_tokens: u32 = 0;
            let mut saw_usage = false;
            // block_index -> in-flight tool_use accumulator.
            let mut pending_tools: HashMap<u32, PendingToolUse> = HashMap::new();
            // Final tool calls in the order Anthropic emitted them.
            let mut emit_order: Vec<u32> = Vec::new();
            let mut completed_tools: HashMap<u32, ToolCall> = HashMap::new();

            while let Some(event) = events.next().await {
                let event = event.map_err(|e| AgentError::Provider(format!("sse: {e}")))?;
                if event.data.is_empty() { continue; }
                let parsed: Result<SseEvent, _> = serde_json::from_str(&event.data);
                match parsed {
                    Ok(SseEvent::MessageStart { message }) => {
                        if let Some(u) = message.usage {
                            input_tokens = u.input_tokens;
                            output_tokens = u.output_tokens;
                            cache_read_tokens = u.cache_read_input_tokens;
                            cache_creation_tokens = u.cache_creation_input_tokens;
                            saw_usage = true;
                        }
                    }
                    Ok(SseEvent::ContentBlockStart { index, content_block }) => {
                        if let BlockStart::ToolUse { id, name, .. } = content_block {
                            emit_order.push(index);
                            pending_tools.insert(index, PendingToolUse {
                                id: id.clone(),
                                name: name.clone(),
                                args_json: String::new(),
                            });
                            yield StreamEvent::ToolUseStart { id, name };
                        }
                    }
                    Ok(SseEvent::ContentBlockDelta { index, delta }) => match delta {
                        SseDelta::TextDelta { text } => {
                            yield StreamEvent::Delta { text };
                        }
                        SseDelta::InputJsonDelta { partial_json } => {
                            if let Some(p) = pending_tools.get_mut(&index) {
                                p.args_json.push_str(&partial_json);
                                yield StreamEvent::ToolUseArgsDelta {
                                    id: p.id.clone(),
                                    fragment: partial_json,
                                };
                            }
                        }
                        SseDelta::Other => {}
                    },
                    Ok(SseEvent::ContentBlockStop { index }) => {
                        if let Some(p) = pending_tools.remove(&index) {
                            // Anthropic emits valid JSON in normal flow.
                            // It can still arrive truncated when max_tokens
                            // cuts a tool call mid-args, in which case we
                            // try a lightweight repair before giving up so
                            // partial argument data still reaches the model
                            // for self-correction.
                            let parsed_args: Value = if p.args_json.trim().is_empty() {
                                json!({})
                            } else {
                                match serde_json::from_str::<Value>(&p.args_json) {
                                    Ok(v) => v,
                                    Err(_) => if let Some(v) = repair_truncated_json(&p.args_json) {
                                        yield StreamEvent::Warning {
                                            message: format!(
                                                "tool args for '{}' were truncated; repaired",
                                                p.name
                                            ),
                                        };
                                        v
                                    } else {
                                        yield StreamEvent::Warning {
                                            message: format!(
                                                "tool args for '{}' malformed; falling back to {{}}",
                                                p.name
                                            ),
                                        };
                                        json!({})
                                    },
                                }
                            };
                            let id = p.id.clone();
                            completed_tools.insert(index, ToolCall {
                                id: id.clone(),
                                name: p.name,
                                arguments: parsed_args,
                            });
                            yield StreamEvent::ToolUseDone { id };
                        }
                    }
                    Ok(SseEvent::MessageDelta { delta, usage: u }) => {
                        if let Some(reason) = delta.stop_reason {
                            finish_reason = Some(reason);
                        }
                        if let Some(u) = u {
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
                Some(TokenUsage {
                    input_tokens,
                    output_tokens,
                    cache_read_tokens,
                    cache_creation_tokens,
                })
            } else {
                None
            };
            let tool_calls: Vec<ToolCall> = emit_order
                .into_iter()
                .filter_map(|i| completed_tools.remove(&i))
                .collect();
            yield StreamEvent::Done { finish_reason, usage, tool_calls };
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
        let raw = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}"#;
        let parsed: SseEvent = serde_json::from_str(raw).unwrap();
        match parsed {
            SseEvent::ContentBlockDelta {
                delta: SseDelta::TextDelta { text },
                ..
            } => assert_eq!(text, "hello"),
            _ => panic!("expected text delta"),
        }
    }

    #[test]
    fn content_block_start_decodes_tool_use() {
        let raw = r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_abc","name":"read_file","input":{}}}"#;
        let parsed: SseEvent = serde_json::from_str(raw).unwrap();
        match parsed {
            SseEvent::ContentBlockStart {
                index,
                content_block: BlockStart::ToolUse { id, name, .. },
            } => {
                assert_eq!(index, 1);
                assert_eq!(id, "toolu_abc");
                assert_eq!(name, "read_file");
            }
            _ => panic!("expected ToolUse start"),
        }
    }

    #[test]
    fn input_json_delta_decodes_partial_json() {
        let raw = r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}}"#;
        let parsed: SseEvent = serde_json::from_str(raw).unwrap();
        match parsed {
            SseEvent::ContentBlockDelta {
                delta: SseDelta::InputJsonDelta { partial_json },
                index,
            } => {
                assert_eq!(index, 1);
                assert_eq!(partial_json, r#"{"path":"#);
            }
            _ => panic!("expected InputJsonDelta"),
        }
    }

    #[test]
    fn non_streaming_response_with_tool_use_extracts_call() {
        let raw = r#"{"content":[{"type":"text","text":"sure"},{"type":"tool_use","id":"toolu_1","name":"read_file","input":{"path":"x.rs"}}],"model":"claude-sonnet-4-6","stop_reason":"tool_use","usage":{"input_tokens":10,"output_tokens":5}}"#;
        let env: CompletionEnvelope = serde_json::from_str(raw).unwrap();
        assert_eq!(env.stop_reason.as_deref(), Some("tool_use"));
        assert_eq!(env.content.len(), 2);
    }

    #[test]
    fn assistant_message_with_tool_calls_serialises_blocks() {
        let m = Message {
            role: Role::Assistant,
            content: "let me check".into(),
            tool_call_id: None,
            tool_name: None,
            tool_calls: Some(vec![ToolCall {
                id: "toolu_1".into(),
                name: "read_file".into(),
                arguments: json!({"path": "x.rs"}),
            }]),
        };
        let v = AnthropicProvider::message_to_blocks(&m);
        assert_eq!(v["role"], "assistant");
        let blocks = v["content"].as_array().unwrap();
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[1]["type"], "tool_use");
        assert_eq!(blocks[1]["id"], "toolu_1");
    }

    #[test]
    fn tool_role_message_becomes_user_with_tool_result_block() {
        let m = Message {
            role: Role::Tool,
            content: "file contents".into(),
            tool_call_id: Some("toolu_1".into()),
            tool_name: None,
            tool_calls: None,
        };
        let v = AnthropicProvider::message_to_blocks(&m);
        assert_eq!(v["role"], "user");
        let blocks = v["content"].as_array().unwrap();
        assert_eq!(blocks[0]["type"], "tool_result");
        assert_eq!(blocks[0]["tool_use_id"], "toolu_1");
        assert_eq!(blocks[0]["content"], "file contents");
    }

    #[test]
    fn unknown_event_kinds_decode_as_other() {
        let raw = r#"{"type":"ping"}"#;
        let parsed: SseEvent = serde_json::from_str(raw).unwrap();
        assert!(matches!(parsed, SseEvent::Other));
    }
}
