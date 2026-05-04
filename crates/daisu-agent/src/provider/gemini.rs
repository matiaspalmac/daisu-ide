//! Google Gemini provider stub. Wired in M3 Phase 1+.

use async_trait::async_trait;

use super::{
    CompletionRequest, CompletionResponse, LlmProvider, ProviderId, StreamResult, ToolCapability,
};
use crate::error::{AgentError, AgentResult};

pub struct GeminiProvider {
    #[allow(dead_code)]
    api_key: String,
}

impl GeminiProvider {
    #[must_use]
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
        }
    }
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
            parallel_calls: false,
        }
    }

    async fn complete(&self, _req: CompletionRequest) -> AgentResult<CompletionResponse> {
        Err(AgentError::ProviderNotConfigured("gemini".into()))
    }

    fn stream(&self, _req: CompletionRequest) -> StreamResult {
        Box::pin(futures::stream::once(async {
            Err(AgentError::ProviderNotConfigured("gemini".into()))
        }))
    }
}
