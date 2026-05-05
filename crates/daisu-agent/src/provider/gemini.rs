//! Google Gemini provider — `streamGenerateContent` over SSE.
//!
//! Uses the v1beta endpoint with `?alt=sse` so each chunk arrives as a
//! standard SSE `data:` line carrying a `GenerateContentResponse`.

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

const API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

pub struct GeminiProvider {
    client: reqwest::Client,
    api_key: String,
}

impl GeminiProvider {
    pub fn new(api_key: impl Into<String>) -> AgentResult<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .build()?;
        Ok(Self {
            client,
            api_key: api_key.into(),
        })
    }

    fn build_body(req: &CompletionRequest) -> serde_json::Value {
        // Gemini roles: user / model. Tool turns map back to "user".
        let mut contents: Vec<serde_json::Value> = Vec::with_capacity(req.messages.len());
        for m in req
            .messages
            .iter()
            .filter(|m| !matches!(m.role, Role::System))
        {
            match m.role {
                Role::Tool => {
                    // Tool result = user content with functionResponse part.
                    // Gemini links by function name (no opaque id), so we
                    // pull from `tool_name` rather than `tool_call_id`
                    // (which carries the provider-specific id used by
                    // OpenAI/Anthropic/LM Studio).
                    let name = m
                        .tool_name
                        .clone()
                        .or_else(|| m.tool_call_id.clone())
                        .unwrap_or_default();
                    let response: serde_json::Value = serde_json::from_str(&m.content)
                        .unwrap_or_else(|_| json!({ "result": m.content }));
                    contents.push(json!({
                        "role": "user",
                        "parts": [{
                            "functionResponse": {
                                "name": name,
                                "response": response,
                            }
                        }],
                    }));
                }
                Role::Assistant => {
                    let mut parts: Vec<serde_json::Value> = Vec::new();
                    if !m.content.is_empty() {
                        parts.push(json!({ "text": m.content }));
                    }
                    if let Some(calls) = m.tool_calls.as_ref() {
                        for c in calls {
                            parts.push(json!({
                                "functionCall": {
                                    "name": c.name,
                                    "args": c.arguments,
                                }
                            }));
                        }
                    }
                    if parts.is_empty() {
                        parts.push(json!({ "text": "" }));
                    }
                    contents.push(json!({ "role": "model", "parts": parts }));
                }
                Role::User => {
                    contents.push(json!({
                        "role": "user",
                        "parts": [{ "text": m.content }],
                    }));
                }
                Role::System => unreachable!(),
            }
        }

        let system = req.system.clone().or_else(|| {
            req.messages
                .iter()
                .find(|m| matches!(m.role, Role::System))
                .map(|m| m.content.clone())
        });

        let mut gen_config = json!({ "maxOutputTokens": req.max_tokens });
        if let Some(t) = req.temperature {
            gen_config["temperature"] = json!(t);
        }

        let mut body = json!({
            "contents": contents,
            "generationConfig": gen_config,
        });
        if let Some(sys) = system {
            body["systemInstruction"] = json!({ "parts": [{ "text": sys }] });
        }
        if !req.tools.is_empty() {
            let declarations: Vec<serde_json::Value> = req
                .tools
                .iter()
                .map(|t| {
                    let mut v = json!({
                        "name": t.name,
                        "parameters": t.input_schema,
                    });
                    if let Some(d) = t.description.as_deref() {
                        v["description"] = json!(d);
                    }
                    v
                })
                .collect();
            body["tools"] = json!([{ "functionDeclarations": declarations }]);
            if let Some(choice) = req.tool_choice {
                let mode = match choice {
                    ToolChoice::Auto => "AUTO",
                    ToolChoice::Required => "ANY",
                    ToolChoice::None => "NONE",
                };
                body["toolConfig"] = json!({
                    "functionCallingConfig": { "mode": mode }
                });
            }
        }
        body
    }
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    #[serde(default)]
    candidates: Vec<Candidate>,
    #[serde(default, rename = "usageMetadata")]
    usage: Option<UsageMetadata>,
    #[serde(default, rename = "modelVersion")]
    model_version: Option<String>,
    /// Populated when safety / recitation filters block the prompt
    /// before any candidate is produced. Without surfacing this the
    /// stream looks empty to the user — they get a turn with no text
    /// and no error.
    #[serde(default, rename = "promptFeedback")]
    prompt_feedback: Option<PromptFeedback>,
}

#[derive(Debug, Deserialize)]
struct PromptFeedback {
    #[serde(default, rename = "blockReason")]
    block_reason: Option<String>,
    #[serde(default, rename = "blockReasonMessage")]
    block_reason_message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Candidate {
    #[serde(default)]
    content: Option<CandidateContent>,
    #[serde(default, rename = "finishReason")]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CandidateContent {
    #[serde(default)]
    parts: Vec<Part>,
}

#[derive(Debug, Deserialize)]
struct Part {
    #[serde(default)]
    text: Option<String>,
    #[serde(default, rename = "functionCall")]
    function_call: Option<GeminiFunctionCall>,
}

#[derive(Debug, Deserialize, Clone)]
struct GeminiFunctionCall {
    name: String,
    #[serde(default)]
    args: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct UsageMetadata {
    #[serde(default, rename = "promptTokenCount")]
    prompt_token_count: u32,
    #[serde(default, rename = "candidatesTokenCount")]
    candidates_token_count: u32,
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
    #[serde(default)]
    models: Vec<GeminiModel>,
}

#[derive(Deserialize)]
struct GeminiModel {
    name: String,
    #[serde(default, rename = "displayName")]
    display_name: Option<String>,
    #[serde(default, rename = "inputTokenLimit")]
    input_token_limit: Option<u32>,
    #[serde(default, rename = "supportedGenerationMethods")]
    supported_generation_methods: Vec<String>,
}

fn extract_text(resp: &GenerateResponse) -> String {
    resp.candidates
        .iter()
        .filter_map(|c| c.content.as_ref())
        .flat_map(|c| c.parts.iter())
        .filter_map(|p| p.text.clone())
        .collect()
}

fn extract_function_calls(resp: &GenerateResponse) -> Vec<GeminiFunctionCall> {
    resp.candidates
        .iter()
        .filter_map(|c| c.content.as_ref())
        .flat_map(|c| c.parts.iter())
        .filter_map(|p| p.function_call.clone())
        .collect()
}

#[async_trait]
impl LlmProvider for GeminiProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Gemini
    }

    fn name(&self) -> &str {
        ProviderId::Gemini.display_name()
    }

    fn supported_tools(&self) -> ToolCapability {
        ProviderId::Gemini.capabilities()
    }

    fn default_model(&self) -> &str {
        ProviderId::Gemini.default_model()
    }

    async fn list_models(&self) -> AgentResult<Vec<ModelInfo>> {
        let resp = self
            .client
            .get(format!("{API_BASE}/models?pageSize=200"))
            .header("x-goog-api-key", &self.api_key)
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
            .models
            .into_iter()
            .filter(|m| {
                // Accept either the unary or streaming method. The chat
                // path uses streaming, but some experimental models only
                // ship streamGenerateContent — filtering on
                // generateContent alone would hide them. Accepting
                // either keeps the catalog inclusive while still
                // filtering out embedding-only / tuning-only models.
                m.supported_generation_methods
                    .iter()
                    .any(|s| s == "generateContent" || s == "streamGenerateContent")
            })
            .map(|m| ModelInfo {
                // Strip the "models/" prefix so the id can be passed back as `model`.
                id: m
                    .name
                    .strip_prefix("models/")
                    .unwrap_or(&m.name)
                    .to_string(),
                display_name: m.display_name,
                context_window: m.input_token_limit,
                supports_tools: true,
            })
            .collect())
    }

    async fn complete(&self, req: CompletionRequest) -> AgentResult<CompletionResponse> {
        let body = Self::build_body(&req);
        let url = format!("{API_BASE}/models/{}:generateContent", req.model);
        let resp = self
            .client
            .post(url)
            .header("x-goog-api-key", &self.api_key)
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

        let env: GenerateResponse = serde_json::from_str(&text)?;
        // If safety filters blocked the prompt, candidates is empty and
        // we'd otherwise return an empty success — promote the block to
        // an error so callers see the reason instead of silence.
        if env.candidates.is_empty() {
            if let Some(fb) = env.prompt_feedback.as_ref() {
                if let Some(reason) = fb.block_reason.as_deref() {
                    let detail = fb
                        .block_reason_message
                        .as_deref()
                        .map_or_else(|| reason.to_string(), |m| format!("{reason}: {m}"));
                    return Err(AgentError::Provider(format!("blocked by Gemini: {detail}")));
                }
            }
        }
        let content = extract_text(&env);
        let calls = extract_function_calls(&env);
        let tool_calls: Vec<ToolCall> = calls
            .into_iter()
            .enumerate()
            .map(|(i, c)| ToolCall {
                // Gemini doesn't issue ids — synthesize one from name+i.
                // Persistence layer keys on `tool_call_id` to round-trip
                // results back, and Gemini matches by function name on
                // its end so the synthetic id is purely internal.
                id: format!("gemini-{i}-{}", c.name),
                name: c.name,
                arguments: c.args,
            })
            .collect();
        let finish_reason = env
            .candidates
            .iter()
            .find_map(|c| c.finish_reason.clone())
            .or_else(|| {
                env.prompt_feedback
                    .as_ref()
                    .and_then(|fb| fb.block_reason.clone())
            });
        let usage = env.usage.map(|u| TokenUsage {
            input_tokens: u.prompt_token_count,
            output_tokens: u.candidates_token_count,
        });
        Ok(CompletionResponse {
            content,
            model: env.model_version.unwrap_or(req.model),
            finish_reason,
            usage,
            tool_calls,
        })
    }

    fn stream(&self, req: CompletionRequest) -> StreamResult {
        let body = Self::build_body(&req);
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        let model = req.model.clone();

        let stream = async_stream::try_stream! {
            let url = format!("{API_BASE}/models/{model}:streamGenerateContent?alt=sse");
            let resp = client
                .post(url)
                .header("x-goog-api-key", &api_key)
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
            let mut tool_calls: Vec<ToolCall> = Vec::new();

            while let Some(event) = events.next().await {
                let event = event.map_err(|e| AgentError::Provider(format!("sse: {e}")))?;
                if event.data.is_empty() { continue; }
                match serde_json::from_str::<GenerateResponse>(&event.data) {
                    Ok(chunk) => {
                        let text = extract_text(&chunk);
                        if !text.is_empty() {
                            yield StreamEvent::Delta { text };
                        }
                        // Function calls in Gemini arrive complete (not
                        // streamed token by token) — emit Start/Args/Done
                        // synthetically per call so downstream sees the
                        // same shape as Anthropic/OpenAI.
                        for c in extract_function_calls(&chunk) {
                            let id = format!("gemini-{}-{}", tool_calls.len(), c.name);
                            let args_json = serde_json::to_string(&c.args)
                                .unwrap_or_else(|_| "{}".into());
                            yield StreamEvent::ToolUseStart {
                                id: id.clone(),
                                name: c.name.clone(),
                            };
                            yield StreamEvent::ToolUseArgsDelta {
                                id: id.clone(),
                                fragment: args_json,
                            };
                            yield StreamEvent::ToolUseDone { id: id.clone() };
                            tool_calls.push(ToolCall {
                                id,
                                name: c.name,
                                arguments: c.args,
                            });
                        }
                        if let Some(fb) = chunk.prompt_feedback.as_ref() {
                            if let Some(reason) = fb.block_reason.clone() {
                                let detail = fb
                                    .block_reason_message
                                    .clone()
                                    .map(|m| format!("{reason}: {m}"))
                                    .unwrap_or(reason.clone());
                                yield StreamEvent::Warning {
                                    message: format!("blocked by Gemini: {detail}"),
                                };
                                finish_reason = Some(reason);
                            }
                        }
                        if let Some(reason) = chunk
                            .candidates
                            .iter()
                            .find_map(|c| c.finish_reason.clone())
                        {
                            finish_reason = Some(reason);
                        }
                        if let Some(u) = chunk.usage {
                            usage = Some(TokenUsage {
                                input_tokens: u.prompt_token_count,
                                output_tokens: u.candidates_token_count,
                            });
                        }
                    }
                    Err(e) => {
                        yield StreamEvent::Warning { message: format!("parse: {e}") };
                    }
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
    fn safety_blocked_response_carries_block_reason() {
        // When safety filters refuse, candidates is empty and the
        // explanation lives in promptFeedback. Without surfacing it the
        // user gets a silent empty turn — regression test for I3.
        let raw = r#"{"candidates":[],"promptFeedback":{"blockReason":"SAFETY","blockReasonMessage":"violates policy"}}"#;
        let env: GenerateResponse = serde_json::from_str(raw).unwrap();
        let fb = env.prompt_feedback.expect("prompt_feedback");
        assert_eq!(fb.block_reason.as_deref(), Some("SAFETY"));
        assert_eq!(fb.block_reason_message.as_deref(), Some("violates policy"));
        assert!(env.candidates.is_empty());
    }

    #[test]
    fn streaming_chunk_extracts_text_parts() {
        let raw = r#"{"candidates":[{"content":{"parts":[{"text":"hi"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":1}}"#;
        let env: GenerateResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(extract_text(&env), "hi");
        assert_eq!(env.candidates[0].finish_reason.as_deref(), Some("STOP"));
        let u = env.usage.expect("usage");
        assert_eq!(u.prompt_token_count, 3);
        assert_eq!(u.candidates_token_count, 1);
    }

    #[test]
    fn list_filter_accepts_streaming_only_models() {
        // Regression: filter only checked generateContent, so a model
        // that only ships streamGenerateContent would disappear from
        // the catalog even though the chat path uses streaming.
        let env: ModelListEnv = serde_json::from_str(
            r#"{"models":[
                {"name":"models/streaming-only","supportedGenerationMethods":["streamGenerateContent"]},
                {"name":"models/standard","supportedGenerationMethods":["generateContent","streamGenerateContent"]},
                {"name":"models/embed-only","supportedGenerationMethods":["embedContent"]}
            ]}"#,
        )
        .unwrap();
        let kept: Vec<&str> = env
            .models
            .iter()
            .filter(|m| {
                m.supported_generation_methods
                    .iter()
                    .any(|s| s == "generateContent" || s == "streamGenerateContent")
            })
            .map(|m| m.name.as_str())
            .collect();
        assert_eq!(kept, vec!["models/streaming-only", "models/standard"]);
    }

    #[test]
    fn function_call_part_decodes_with_object_args() {
        let raw = r#"{"candidates":[{"content":{"parts":[{"functionCall":{"name":"list_dir","args":{"path":"."}}}]}}]}"#;
        let env: GenerateResponse = serde_json::from_str(raw).unwrap();
        let calls = extract_function_calls(&env);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "list_dir");
        assert_eq!(calls[0].args["path"], ".");
    }

    #[test]
    fn tool_role_uses_tool_name_not_tool_call_id_for_function_response() {
        // Regression: previously tool_call_id was overloaded as the
        // function name. Now Gemini reads tool_name; tool_call_id (the
        // opaque id used by other providers) is ignored on this path.
        let m = super::super::Message {
            role: Role::Tool,
            content: r#"{"path":"x.rs","ok":true}"#.into(),
            tool_call_id: Some("ignored-opaque-id".into()),
            tool_name: Some("read_file".into()),
            tool_calls: None,
        };
        let req = CompletionRequest {
            model: "gemini-2.5-pro".into(),
            messages: vec![m],
            system: None,
            max_tokens: 1024,
            temperature: None,
            tools: vec![],
            tool_choice: None,
        };
        let body = GeminiProvider::build_body(&req);
        let parts = body["contents"][0]["parts"].as_array().unwrap();
        assert_eq!(parts[0]["functionResponse"]["name"], "read_file");
    }

    #[test]
    fn parts_with_text_and_function_call_extract_separately() {
        let raw = r#"{"candidates":[{"content":{"parts":[{"text":"let me check"},{"functionCall":{"name":"read_file","args":{"path":"x.rs"}}}]}}]}"#;
        let env: GenerateResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(extract_text(&env), "let me check");
        let calls = extract_function_calls(&env);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "read_file");
    }
}
