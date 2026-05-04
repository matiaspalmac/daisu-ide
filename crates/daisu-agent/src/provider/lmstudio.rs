//! LM Studio local provider stub. Wired in M3 Phase 1+.

use async_trait::async_trait;

use super::{
    CompletionRequest, CompletionResponse, LlmProvider, ProviderId, StreamResult, ToolCapability,
};
use crate::error::{AgentError, AgentResult};

pub struct LmStudioProvider {
    #[allow(dead_code)]
    base_url: String,
}

impl LmStudioProvider {
    #[must_use]
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
        }
    }
}

impl Default for LmStudioProvider {
    fn default() -> Self {
        Self::new("http://localhost:1234/v1")
    }
}

#[async_trait]
impl LlmProvider for LmStudioProvider {
    fn id(&self) -> ProviderId {
        ProviderId::LmStudio
    }

    fn name(&self) -> &str {
        "LM Studio (local)"
    }

    fn supported_tools(&self) -> ToolCapability {
        ToolCapability::default()
    }

    async fn complete(&self, _req: CompletionRequest) -> AgentResult<CompletionResponse> {
        Err(AgentError::ProviderNotConfigured("lmstudio".into()))
    }

    fn stream(&self, _req: CompletionRequest) -> StreamResult {
        Box::pin(futures::stream::once(async {
            Err(AgentError::ProviderNotConfigured("lmstudio".into()))
        }))
    }
}
