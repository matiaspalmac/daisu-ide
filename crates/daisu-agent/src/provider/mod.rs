//! Provider abstraction shared by Anthropic, OpenAI, Gemini, Ollama,
//! and LM Studio.
//!
//! A `LlmProvider` is a thin async trait: ask it to `complete` (single
//! response) or `stream` (incremental tokens). Tool support is opt-in
//! via `supported_tools`.

use std::pin::Pin;

use async_trait::async_trait;
use futures::Stream;
use serde::{Deserialize, Serialize};

use crate::AgentResult;

pub mod anthropic;
pub mod gemini;
pub mod lmstudio;
pub mod ollama;
pub mod openai;

#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderId {
    Anthropic,
    OpenAi,
    Gemini,
    Ollama,
    LmStudio,
}

impl ProviderId {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::OpenAi => "openai",
            Self::Gemini => "gemini",
            Self::Ollama => "ollama",
            Self::LmStudio => "lmstudio",
        }
    }

    #[must_use]
    pub fn requires_key(self) -> bool {
        matches!(self, Self::Anthropic | Self::OpenAi | Self::Gemini)
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default)]
    pub temperature: Option<f32>,
}

const fn default_max_tokens() -> u32 {
    4096
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub content: String,
    pub model: String,
    pub finish_reason: Option<String>,
    pub usage: Option<TokenUsage>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// Incremental events emitted while a response streams.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    /// Token / chunk of assistant text.
    Delta { text: String },
    /// Stream finished cleanly.
    Done {
        finish_reason: Option<String>,
        usage: Option<TokenUsage>,
    },
    /// Stream errored mid-flight (the provider is still responsible for
    /// surfacing the error via the stream's `Err` channel; this event is
    /// for soft errors that don't terminate the stream).
    Warning { message: String },
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ToolCapability {
    pub function_calls: bool,
    pub parallel_calls: bool,
}

/// Metadata describing a single model exposed by a provider's catalog.
/// Returned from `list_models` so the UI can show every model the
/// provider currently advertises without us hardcoding lists.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    #[serde(default)]
    pub supports_tools: bool,
}

pub type StreamResult = Pin<Box<dyn Stream<Item = AgentResult<StreamEvent>> + Send>>;

#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn id(&self) -> ProviderId;
    fn name(&self) -> &str;
    fn supported_tools(&self) -> ToolCapability;
    /// Recommended default model for new conversations. UI pre-selects
    /// this in the dropdown; users can pick any model from `list_models`.
    fn default_model(&self) -> &str;
    /// Fetch the live catalog of models the provider currently exposes.
    /// Implementations hit the provider's models endpoint — we never
    /// hardcode lists since they change every release.
    async fn list_models(&self) -> AgentResult<Vec<ModelInfo>>;
    async fn complete(&self, req: CompletionRequest) -> AgentResult<CompletionResponse>;
    fn stream(&self, req: CompletionRequest) -> StreamResult;
}
