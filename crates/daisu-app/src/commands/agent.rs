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
    clippy::struct_excessive_bools
)]

use std::path::PathBuf;
use std::sync::Arc;

use daisu_agent::{
    keychain,
    permission::gate::PERMISSION_REQUEST_EVENT,
    provider::{anthropic::AnthropicProvider, ollama::OllamaProvider, ProviderId, ToolCapability},
    AgentResult, AllowlistEntry, CompletionRequest, Decision, EventEmitter, LlmProvider, Message,
    PermissionGate, PermissionRequestEvent, Role, ToolCall, ToolDescriptor, ToolResult,
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

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

// ─── M3 Phase 2: tool dispatcher + permission gate ───────────────────

/// Tauri-backed event emitter that the agent crate uses to push
/// permission requests to the frontend. Keeps `daisu-agent` Tauri-free.
struct TauriEmitter {
    handle: tauri::AppHandle,
}

impl EventEmitter for TauriEmitter {
    fn emit(&self, event: &str, payload: &PermissionRequestEvent) -> Result<(), String> {
        self.handle.emit(event, payload).map_err(|e| e.to_string())
    }
}

fn workspace_db_path(workspace: &std::path::Path) -> PathBuf {
    workspace.join(".daisu").join("agent.db")
}

fn gate_for_workspace(
    state: &AppState,
    handle: &tauri::AppHandle,
    workspace: &std::path::Path,
) -> AppResult<Arc<PermissionGate>> {
    let mut gates = state.permission_gates.lock();
    if let Some(existing) = gates.get(workspace) {
        return Ok(existing.clone());
    }
    let store =
        daisu_agent::memory::MemoryStore::open(workspace_db_path(workspace)).map_err(map_agent)?;
    let emitter: Arc<dyn EventEmitter> = Arc::new(TauriEmitter {
        handle: handle.clone(),
    });
    let gate = Arc::new(PermissionGate::new(Arc::new(store), emitter));
    gates.insert(workspace.to_path_buf(), gate.clone());
    Ok(gate)
}

#[tauri::command]
#[must_use]
pub fn agent_tool_list(state: State<'_, AppState>) -> Vec<ToolDescriptor> {
    state.tool_registry.descriptors()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDispatchRequest {
    pub tool: String,
    pub arguments: serde_json::Value,
    pub scope: String,
    pub workspace_path: String,
}

#[tauri::command]
pub async fn agent_tool_dispatch(
    handle: tauri::AppHandle,
    req: ToolDispatchRequest,
) -> AppResult<ToolResult> {
    let workspace = PathBuf::from(&req.workspace_path);
    let state = handle.state::<AppState>();
    let gate = gate_for_workspace(&state, &handle, &workspace)?;
    let registry = state.tool_registry.clone();
    let call = ToolCall {
        name: req.tool,
        arguments: req.arguments,
    };
    Ok(registry.dispatch(call, &gate, &workspace, &req.scope).await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResolveRequest {
    pub workspace_path: String,
    pub request_id: String,
    pub decision: Decision,
}

#[tauri::command]
pub fn agent_permission_resolve(
    handle: tauri::AppHandle,
    req: PermissionResolveRequest,
) -> AppResult<bool> {
    let state = handle.state::<AppState>();
    let workspace = PathBuf::from(&req.workspace_path);
    let gate = gate_for_workspace(&state, &handle, &workspace)?;
    Ok(gate.resolve(&req.request_id, req.decision))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowlistListRequest {
    pub workspace_path: String,
}

#[tauri::command]
pub fn agent_permission_list_allowlist(
    handle: tauri::AppHandle,
    req: AllowlistListRequest,
) -> AppResult<Vec<AllowlistEntry>> {
    let state = handle.state::<AppState>();
    let workspace = PathBuf::from(&req.workspace_path);
    let gate = gate_for_workspace(&state, &handle, &workspace)?;
    gate.list_allowlist().map_err(map_agent)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowlistClearRequest {
    pub workspace_path: String,
    pub tool_name: Option<String>,
}

#[tauri::command]
pub fn agent_permission_clear_allowlist(
    handle: tauri::AppHandle,
    req: AllowlistClearRequest,
) -> AppResult<usize> {
    let state = handle.state::<AppState>();
    let workspace = PathBuf::from(&req.workspace_path);
    let gate = gate_for_workspace(&state, &handle, &workspace)?;
    gate.clear_allowlist(req.tool_name.as_deref())
        .map_err(map_agent)
}

/// Re-export of the event name so `lib.rs` can use it without
/// reaching into `daisu-agent` internals.
pub const PERMISSION_REQUEST_EVENT_NAME: &str = PERMISSION_REQUEST_EVENT;

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
