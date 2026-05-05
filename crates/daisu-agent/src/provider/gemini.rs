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
    StreamResult, TokenUsage, ToolCapability,
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
        let contents: Vec<_> = req
            .messages
            .iter()
            .filter(|m| !matches!(m.role, Role::System))
            .map(|m| {
                let role = match m.role {
                    Role::User | Role::Tool => "user",
                    Role::Assistant => "model",
                    Role::System => unreachable!(),
                };
                json!({
                    "role": role,
                    "parts": [{ "text": m.content }],
                })
            })
            .collect();

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

#[async_trait]
impl LlmProvider for GeminiProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Gemini
    }

    fn name(&self) -> &str {
        "Google Gemini"
    }

    fn supported_tools(&self) -> ToolCapability {
        ToolCapability {
            function_calls: true,
            parallel_calls: true,
        }
    }

    fn default_model(&self) -> &str {
        "gemini-2.5-pro"
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
                m.supported_generation_methods
                    .iter()
                    .any(|s| s == "generateContent")
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
        let content = extract_text(&env);
        let finish_reason = env.candidates.iter().find_map(|c| c.finish_reason.clone());
        let usage = env.usage.map(|u| TokenUsage {
            input_tokens: u.prompt_token_count,
            output_tokens: u.candidates_token_count,
        });
        Ok(CompletionResponse {
            content,
            model: env.model_version.unwrap_or(req.model),
            finish_reason,
            usage,
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
                match serde_json::from_str::<GenerateResponse>(&event.data) {
                    Ok(chunk) => {
                        let text = extract_text(&chunk);
                        if !text.is_empty() {
                            yield StreamEvent::Delta { text };
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

            yield StreamEvent::Done { finish_reason, usage };
        };

        Box::pin(stream)
    }
}
