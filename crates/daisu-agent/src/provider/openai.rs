//! OpenAI provider stub. Wired in M3 Phase 1+.

use async_trait::async_trait;

use super::{
    CompletionRequest, CompletionResponse, LlmProvider, ProviderId, StreamResult, ToolCapability,
};
use crate::error::{AgentError, AgentResult};

pub struct OpenAiProvider {
    #[allow(dead_code)]
    api_key: String,
}

impl OpenAiProvider {
    #[must_use]
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
        }
    }
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn id(&self) -> ProviderId {
        ProviderId::OpenAi
    }

    fn name(&self) -> &str {
        "OpenAI"
    }

    fn supported_tools(&self) -> ToolCapability {
        ToolCapability {
            function_calls: true,
            parallel_calls: true,
        }
    }

    async fn complete(&self, _req: CompletionRequest) -> AgentResult<CompletionResponse> {
        Err(AgentError::ProviderNotConfigured("openai".into()))
    }

    fn stream(&self, _req: CompletionRequest) -> StreamResult {
        Box::pin(futures::stream::once(async {
            Err(AgentError::ProviderNotConfigured("openai".into()))
        }))
    }
}
