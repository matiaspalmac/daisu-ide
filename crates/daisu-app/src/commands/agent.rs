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
    clippy::unused_async
)]

use std::path::PathBuf;
use std::str::FromStr;

use daisu_agent::{
    keychain,
    provider::{anthropic::AnthropicProvider, ollama::OllamaProvider, ProviderId, ToolCapability},
    tools::{apply_accepted_hunks, EditHunk, ProposeEdit},
    AgentResult, CompletionRequest, LlmProvider, Message, Role,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::commands::file_ops::{read_file_at, write_file_at};
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

// ---------------------------------------------------------------------------
// Inline edit proposals (M3 Phase 3)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeEditRequest {
    pub workspace_path: Option<String>,
    pub path: String,
    pub new_text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditProposal {
    pub proposal_id: String,
    pub path: String,
    pub hunks: Vec<EditHunk>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyEditRequest {
    pub proposal_id: String,
    pub accepted_hunk_indices: Vec<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub path: String,
    pub bytes: u64,
    pub line_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectEditRequest {
    pub proposal_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingEdit {
    pub proposal_id: String,
    pub path: String,
    pub hunk_count: usize,
}

fn parse_uuid(s: &str) -> AppResult<Uuid> {
    Uuid::from_str(s).map_err(|e| AppError::Internal(format!("invalid proposal_id: {e}")))
}

#[tauri::command]
pub async fn agent_propose_edit(
    state: tauri::State<'_, AppState>,
    req: ProposeEditRequest,
) -> AppResult<EditProposal> {
    let _ = req.workspace_path; // reserved for future workspace-scoped sandboxing
    let path = PathBuf::from(&req.path);
    let old_text = read_file_at(&path).await.unwrap_or_default();
    let proposal = ProposeEdit::new(path.clone(), old_text, req.new_text);
    let hunks = proposal.hunks.clone();
    let id = state.register_pending_edit(proposal);
    Ok(EditProposal {
        proposal_id: id.to_string(),
        path: path.display().to_string(),
        hunks,
    })
}

#[tauri::command]
pub async fn agent_apply_edit(
    state: tauri::State<'_, AppState>,
    req: ApplyEditRequest,
) -> AppResult<ApplyResult> {
    let id = parse_uuid(&req.proposal_id)?;
    let proposal = state
        .take_pending_edit(id)
        .ok_or_else(|| AppError::Internal(format!("unknown proposal_id: {}", req.proposal_id)))?;
    let final_text = apply_accepted_hunks(
        &proposal.old_text,
        &proposal.hunks,
        &req.accepted_hunk_indices,
    );
    write_file_at(&proposal.path, &final_text).await?;
    let bytes = u64::try_from(final_text.len()).unwrap_or(u64::MAX);
    let line_count = final_text.lines().count();
    Ok(ApplyResult {
        path: proposal.path.display().to_string(),
        bytes,
        line_count,
    })
}

#[tauri::command]
pub async fn agent_reject_edit(
    state: tauri::State<'_, AppState>,
    req: RejectEditRequest,
) -> AppResult<()> {
    let id = parse_uuid(&req.proposal_id)?;
    let _ = state.take_pending_edit(id);
    Ok(())
}

#[tauri::command]
pub async fn agent_list_pending_edits(
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<PendingEdit>> {
    Ok(state
        .list_pending_edits()
        .into_iter()
        .map(|(id, path, hunk_count)| PendingEdit {
            proposal_id: id.to_string(),
            path: path.display().to_string(),
            hunk_count,
        })
        .collect())
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
