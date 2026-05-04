//! Tauri command bridge for the daisu-agent crate.
//!
//! Frontend talks to the agent runtime through this thin layer:
//!   - provider listing + capability discovery
//!   - per-provider key management via the OS keychain
//!   - connection test against a configured provider
//!
//! Streaming (`agent_send_message`) and persistence
//! (`agent_list_conversations`) land alongside the chat UI in
//! M3 Phase 1; this module only ships the Phase 0 surface.

#![allow(
    clippy::missing_errors_doc,
    clippy::needless_pass_by_value,
    clippy::struct_excessive_bools,
    clippy::similar_names
)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use daisu_agent::{
    index::{IndexStatus, Indexer, SymbolHit},
    keychain,
    provider::{anthropic::AnthropicProvider, ollama::OllamaProvider, ProviderId, ToolCapability},
    AgentResult, CompletionRequest, LlmProvider, Message, Role,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

fn map_agent(e: daisu_agent::AgentError) -> AppError {
    AppError::Internal(format!("agent: {e}"))
}

#[derive(Debug, Serialize)]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub requires_key: bool,
    pub has_key: bool,
    pub supports_tools: bool,
    pub supports_parallel_tools: bool,
    pub implemented: bool,
}

#[tauri::command]
pub async fn agent_provider_list() -> AppResult<Vec<ProviderInfo>> {
    let entries = [
        (
            ProviderId::Ollama,
            "Ollama (local)",
            ToolCapability::default(),
            true,
        ),
        (
            ProviderId::Anthropic,
            "Anthropic Claude",
            ToolCapability {
                function_calls: true,
                parallel_calls: true,
            },
            true,
        ),
        (
            ProviderId::OpenAi,
            "OpenAI",
            ToolCapability {
                function_calls: true,
                parallel_calls: true,
            },
            false,
        ),
        (
            ProviderId::Gemini,
            "Google Gemini",
            ToolCapability {
                function_calls: true,
                parallel_calls: false,
            },
            false,
        ),
        (
            ProviderId::LmStudio,
            "LM Studio (local)",
            ToolCapability::default(),
            false,
        ),
    ];

    let mut out = Vec::with_capacity(entries.len());
    for (id, name, caps, implemented) in entries {
        let requires_key = id.requires_key();
        let has_key = if requires_key {
            tokio::task::spawn_blocking(move || keychain::has_key(id.as_str()))
                .await
                .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
                .map_err(map_agent)?
        } else {
            true
        };
        out.push(ProviderInfo {
            id: id.as_str().into(),
            name: name.into(),
            requires_key,
            has_key,
            supports_tools: caps.function_calls,
            supports_parallel_tools: caps.parallel_calls,
            implemented,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn agent_key_set(provider: String, secret: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || keychain::set_key(&provider, &secret))
        .await
        .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
        .map_err(map_agent)
}

#[tauri::command]
pub async fn agent_key_clear(provider: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || keychain::clear_key(&provider))
        .await
        .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
        .map_err(map_agent)
}

#[tauri::command]
pub async fn agent_key_has(provider: String) -> AppResult<bool> {
    tokio::task::spawn_blocking(move || keychain::has_key(&provider))
        .await
        .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
        .map_err(map_agent)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestRequest {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResponse {
    pub ok: bool,
    pub model: String,
    pub sample: String,
    pub latency_ms: u128,
}

#[tauri::command]
pub async fn agent_provider_test(req: ProviderTestRequest) -> AppResult<ProviderTestResponse> {
    let started = std::time::Instant::now();
    let provider = build_provider(&req.provider, req.base_url.as_deref()).await?;

    let completion_req = CompletionRequest {
        model: req.model.clone(),
        messages: vec![Message {
            role: Role::User,
            content: "Say the single word 'ok'.".into(),
            tool_call_id: None,
        }],
        system: None,
        max_tokens: 32,
        temperature: Some(0.0),
    };

    let resp = provider.complete(completion_req).await.map_err(map_agent)?;
    Ok(ProviderTestResponse {
        ok: true,
        model: resp.model,
        sample: resp.content,
        latency_ms: started.elapsed().as_millis(),
    })
}

async fn build_provider(provider: &str, base_url: Option<&str>) -> AppResult<Box<dyn LlmProvider>> {
    match provider {
        "ollama" => {
            let url = base_url.unwrap_or("http://localhost:11434").to_string();
            let p = OllamaProvider::new(url).map_err(map_agent)?;
            Ok(Box::new(p))
        }
        "anthropic" => {
            let key = load_key("anthropic").await?;
            let p = AnthropicProvider::new(key).map_err(map_agent)?;
            Ok(Box::new(p))
        }
        other => Err(AppError::Internal(format!(
            "provider not yet implemented: {other}"
        ))),
    }
}

async fn load_key(provider: &str) -> AppResult<String> {
    let provider = provider.to_string();
    let key: AgentResult<Option<String>> =
        tokio::task::spawn_blocking(move || keychain::get_key(&provider))
            .await
            .map_err(|e| AppError::Internal(format!("agent join: {e}")))?;
    match key.map_err(map_agent)? {
        Some(k) => Ok(k),
        None => Err(AppError::Internal("no api key configured".into())),
    }
}

// ─── Symbol index (M3 Phase 4) ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRebuildRequest {
    pub workspace_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRebuildResponse {
    pub indexed: usize,
    pub duration_ms: u128,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSearchRequest {
    pub workspace_path: String,
    pub query: String,
    pub limit: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatusRequest {
    pub workspace_path: String,
}

fn db_path_for(workspace: &Path) -> PathBuf {
    workspace.join(".daisu").join("symbols.db")
}

fn get_or_open_indexer(state: &AppState, workspace: &Path) -> AppResult<Arc<Indexer>> {
    if let Some(existing) = state.indexer_for(workspace) {
        return Ok(existing);
    }
    let db_path = db_path_for(workspace);
    let indexer = Indexer::new(workspace, &db_path).map_err(map_agent)?;
    let arc = Arc::new(indexer);
    state.insert_indexer(workspace.to_path_buf(), arc.clone());
    Ok(arc)
}

#[tauri::command]
pub async fn agent_index_rebuild(
    state: State<'_, AppState>,
    req: IndexRebuildRequest,
) -> AppResult<IndexRebuildResponse> {
    let workspace = PathBuf::from(&req.workspace_path);
    let indexer = get_or_open_indexer(&state, &workspace)?;
    let started = std::time::Instant::now();
    let indexed = tokio::task::spawn_blocking(move || indexer.rebuild())
        .await
        .map_err(|e| AppError::Internal(format!("index join: {e}")))?
        .map_err(map_agent)?;
    Ok(IndexRebuildResponse {
        indexed,
        duration_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
pub async fn agent_index_search(
    state: State<'_, AppState>,
    req: IndexSearchRequest,
) -> AppResult<Vec<SymbolHit>> {
    let workspace = PathBuf::from(&req.workspace_path);
    let indexer = get_or_open_indexer(&state, &workspace)?;
    let query = req.query;
    let limit = req.limit;
    let hits = tokio::task::spawn_blocking(move || indexer.search(&query, limit))
        .await
        .map_err(|e| AppError::Internal(format!("index join: {e}")))?
        .map_err(map_agent)?;
    Ok(hits)
}

#[tauri::command]
pub async fn agent_index_status(
    state: State<'_, AppState>,
    req: IndexStatusRequest,
) -> AppResult<IndexStatus> {
    let workspace = PathBuf::from(&req.workspace_path);
    let indexer = get_or_open_indexer(&state, &workspace)?;
    let status = tokio::task::spawn_blocking(move || indexer.status())
        .await
        .map_err(|e| AppError::Internal(format!("index join: {e}")))?
        .map_err(map_agent)?;
    Ok(status)
}
