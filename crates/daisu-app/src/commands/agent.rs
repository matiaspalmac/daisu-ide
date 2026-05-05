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
    clippy::similar_names,
    clippy::too_many_lines,
    clippy::match_same_arms,
    clippy::unused_async
)]

use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;

use daisu_agent::{
    index::{IndexStatus, Indexer, SymbolHit},
    keychain,
    memory::{ConversationSummary, MemoryStore, StoredMessage},
    permission::gate::PERMISSION_REQUEST_EVENT,
    provider::{
        anthropic::AnthropicProvider, gemini::GeminiProvider, lmstudio::LmStudioProvider,
        ollama::OllamaProvider, openai::OpenAiProvider, ProviderId, ToolCapability,
    },
    runtime::CancelToken,
    tools::{apply_accepted_hunks, EditHunk, ProposeEdit},
    AgentResult, AllowlistEntry, CompletionRequest, Decision, EventEmitter, LlmProvider,
    McpServerConfig, McpToolResult, Message, ModelInfo, PermissionGate, PermissionRequestEvent,
    Role, StreamEvent, ToolCall, ToolDescriptor, ToolResult,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

use crate::commands::file_ops::{read_file_at, write_file_at};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Tauri event emitted when an MCP server connect attempt succeeds or fails.
const MCP_STATUS_EVENT: &str = "agent://mcp-status";

fn map_agent(e: daisu_agent::AgentError) -> AppError {
    AppError::Internal(format!("agent: {e}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub requires_key: bool,
    pub has_key: bool,
    pub supports_tools: bool,
    pub supports_parallel_tools: bool,
    pub implemented: bool,
    /// Suggested model id for new conversations. UI pre-selects this in
    /// the dropdown; users can pick anything from the live catalog.
    /// Empty string means "no static default" (LM Studio — depends on
    /// what's loaded).
    pub default_model: String,
}

#[tauri::command]
pub async fn agent_provider_list() -> AppResult<Vec<ProviderInfo>> {
    // Single source of truth: capabilities, display names, and default
    // models all flow from `ProviderId` into both the trait impls and
    // this metadata response. No drift possible.
    let ids = [
        ProviderId::Ollama,
        ProviderId::Anthropic,
        ProviderId::OpenAi,
        ProviderId::Gemini,
        ProviderId::LmStudio,
    ];

    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        let requires_key = id.requires_key();
        let has_key = if requires_key {
            tokio::task::spawn_blocking(move || keychain::has_key(id.as_str()))
                .await
                .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
                .map_err(map_agent)?
        } else {
            true
        };
        let caps: ToolCapability = id.capabilities();
        out.push(ProviderInfo {
            id: id.as_str().into(),
            name: id.display_name().into(),
            requires_key,
            has_key,
            supports_tools: caps.function_calls,
            supports_parallel_tools: caps.parallel_calls,
            // All five providers ship full implementations as of M3 Phase 1.
            implemented: true,
            default_model: id.default_model().to_string(),
        });
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelsRequest {
    pub provider: String,
    #[serde(default)]
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelsResponse {
    pub models: Vec<ModelInfo>,
    pub default_model: String,
}

#[tauri::command]
pub async fn agent_provider_models(
    req: ProviderModelsRequest,
) -> AppResult<ProviderModelsResponse> {
    let provider = build_provider(&req.provider, req.base_url.as_deref()).await?;
    let default_model = provider.default_model().to_string();
    let models = provider.list_models().await.map_err(map_agent)?;
    Ok(ProviderModelsResponse {
        models,
        default_model,
    })
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

    // LM Studio (and any provider with no static default) needs a real
    // model id to talk to — pulling the first one off `list_models`
    // lets the user hit "Test connection" without manually selecting a
    // model first.
    let model = if req.model.is_empty() {
        let models = provider.list_models().await.map_err(map_agent)?;
        models
            .into_iter()
            .next()
            .map(|m| m.id)
            .ok_or_else(|| AppError::Internal("no models available on this endpoint".into()))?
    } else {
        req.model.clone()
    };

    let completion_req = CompletionRequest {
        model: model.clone(),
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
        "openai" => {
            let key = load_key("openai").await?;
            let p = OpenAiProvider::new(key).map_err(map_agent)?;
            Ok(Box::new(p))
        }
        "gemini" => {
            let key = load_key("gemini").await?;
            let p = GeminiProvider::new(key).map_err(map_agent)?;
            Ok(Box::new(p))
        }
        "lmstudio" => {
            let url = base_url.unwrap_or("http://localhost:1234/v1").to_string();
            let p = LmStudioProvider::new(url).map_err(map_agent)?;
            Ok(Box::new(p))
        }
        other => Err(AppError::Internal(format!("unknown provider: {other}"))),
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

/// Validate that the workspace path the frontend sent is an existing
/// directory and canonicalise it before any IO. Rejects symlink games
/// and non-existent paths so `MemoryStore::open` never gets handed a
/// crafted location outside the user's real filesystem.
fn validate_workspace(raw: &str) -> AppResult<PathBuf> {
    if raw.trim().is_empty() {
        return Err(AppError::Internal("empty workspace path".into()));
    }
    let candidate = PathBuf::from(raw);
    let canonical = candidate
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("workspace canonicalize: {e}")))?;
    if !canonical.is_dir() {
        return Err(AppError::Internal(format!(
            "workspace is not a directory: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
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

// -- MCP commands -----------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatusInfo {
    pub name: String,
    pub connected: bool,
    pub tool_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub server: String,
    pub name: String,
    pub description: Option<String>,
    pub schema: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectRequest {
    pub config: McpServerConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDisconnectRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpListToolsRequest {
    #[serde(default)]
    pub server_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallToolRequest {
    pub server: String,
    pub tool: String,
    #[serde(default = "default_args")]
    pub arguments: serde_json::Value,
}

fn default_args() -> serde_json::Value {
    serde_json::json!({})
}

#[tauri::command]
pub async fn agent_mcp_connect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: McpConnectRequest,
) -> AppResult<McpStatusInfo> {
    let registry = state.mcp_registry.clone();
    let name = req.config.name.clone();
    match registry.connect(req.config).await {
        Ok(client) => {
            let status = client.status().await;
            let _ = app.emit(
                MCP_STATUS_EVENT,
                serde_json::json!({ "name": name, "ok": true }),
            );
            Ok(McpStatusInfo {
                name: status.name,
                connected: status.connected,
                tool_count: status.tool_count,
            })
        }
        Err(e) => {
            let msg = e.to_string();
            let _ = app.emit(
                MCP_STATUS_EVENT,
                serde_json::json!({ "name": name, "ok": false, "error": msg }),
            );
            Err(map_agent(e))
        }
    }
}

#[tauri::command]
pub async fn agent_mcp_disconnect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: McpDisconnectRequest,
) -> AppResult<bool> {
    let removed = state.mcp_registry.disconnect(&req.name).await;
    if removed {
        let _ = app.emit(
            MCP_STATUS_EVENT,
            serde_json::json!({
                "name": req.name,
                "ok": true,
                "connected": false,
                "event": "disconnected",
            }),
        );
    }
    Ok(removed)
}

#[tauri::command]
pub async fn agent_mcp_status(state: State<'_, AppState>) -> AppResult<Vec<McpStatusInfo>> {
    Ok(state
        .mcp_registry
        .statuses()
        .await
        .into_iter()
        .map(|s| McpStatusInfo {
            name: s.name,
            connected: s.connected,
            tool_count: s.tool_count,
        })
        .collect())
}

#[tauri::command]
pub async fn agent_mcp_list_tools(
    state: State<'_, AppState>,
    req: McpListToolsRequest,
) -> AppResult<Vec<McpToolInfo>> {
    let all = state.mcp_registry.tools().await;
    let filtered: Vec<McpToolInfo> = all
        .into_iter()
        .filter(|(server, _)| {
            req.server_name
                .as_ref()
                .is_none_or(|filter| filter == server)
        })
        .map(|(server, tool)| McpToolInfo {
            server,
            name: tool.name,
            description: tool.description,
            schema: tool.input_schema,
        })
        .collect();
    Ok(filtered)
}

#[tauri::command]
pub async fn agent_mcp_call_tool(
    state: State<'_, AppState>,
    req: McpCallToolRequest,
) -> AppResult<McpToolResult> {
    let client =
        state.mcp_registry.get(&req.server).await.ok_or_else(|| {
            AppError::Internal(format!("mcp server not connected: {}", req.server))
        })?;
    client
        .call_tool(&req.tool, req.arguments)
        .await
        .map_err(map_agent)
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
    let workspace = validate_workspace(&req.workspace_path)?;
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
    let workspace = validate_workspace(&req.workspace_path)?;
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
    let workspace = validate_workspace(&req.workspace_path)?;
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
    let workspace = validate_workspace(&req.workspace_path)?;
    let gate = gate_for_workspace(&state, &handle, &workspace)?;
    gate.clear_allowlist(req.tool_name.as_deref())
        .map_err(map_agent)
}

/// Re-export of the event name so `lib.rs` can use it without
/// reaching into `daisu-agent` internals.
pub const PERMISSION_REQUEST_EVENT_NAME: &str = PERMISSION_REQUEST_EVENT;

// ----------------------------------------------------------------------------
// Conversations + streaming (M3 Phase 1)
// ----------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationRequest {
    pub workspace_path: String,
    pub title: String,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationResponse {
    pub id: String,
}

fn store_for(state: &State<'_, AppState>, workspace: &str) -> AppResult<Arc<MemoryStore>> {
    state
        .agent_memory(&PathBuf::from(workspace))
        .map_err(AppError::Internal)
}

#[tauri::command]
pub async fn agent_create_conversation(
    state: State<'_, AppState>,
    req: CreateConversationRequest,
) -> AppResult<CreateConversationResponse> {
    let store = store_for(&state, &req.workspace_path)?;
    let id = tokio::task::spawn_blocking(move || {
        store.create_conversation(&req.title, &req.provider, &req.model)
    })
    .await
    .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
    .map_err(map_agent)?;
    Ok(CreateConversationResponse { id })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListConversationsRequest {
    pub workspace_path: String,
}

#[tauri::command]
pub async fn agent_list_conversations(
    state: State<'_, AppState>,
    req: ListConversationsRequest,
) -> AppResult<Vec<ConversationSummary>> {
    let store = store_for(&state, &req.workspace_path)?;
    tokio::task::spawn_blocking(move || store.list_conversations())
        .await
        .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
        .map_err(map_agent)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetMessagesRequest {
    pub workspace_path: String,
    pub conversation_id: String,
}

#[tauri::command]
pub async fn agent_get_messages(
    state: State<'_, AppState>,
    req: GetMessagesRequest,
) -> AppResult<Vec<StoredMessage>> {
    let store = store_for(&state, &req.workspace_path)?;
    tokio::task::spawn_blocking(move || store.get_messages(&req.conversation_id))
        .await
        .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
        .map_err(map_agent)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteConversationRequest {
    pub workspace_path: String,
    pub conversation_id: String,
}

#[tauri::command]
pub async fn agent_delete_conversation(
    state: State<'_, AppState>,
    req: DeleteConversationRequest,
) -> AppResult<()> {
    let store = store_for(&state, &req.workspace_path)?;
    tokio::task::spawn_blocking(move || store.delete_conversation(&req.conversation_id))
        .await
        .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
        .map_err(map_agent)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    pub workspace_path: String,
    pub conversation_id: String,
    pub user_text: String,
    pub system_prompt: Option<String>,
    pub base_url: Option<String>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageResponse {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
enum StreamPayload {
    Started {
        run_id: String,
        conversation_id: String,
    },
    Delta {
        run_id: String,
        text: String,
    },
    Warning {
        run_id: String,
        message: String,
    },
    Done {
        run_id: String,
        message_id: String,
    },
    Error {
        run_id: String,
        message: String,
    },
    Cancelled {
        run_id: String,
    },
}

const STREAM_EVENT: &str = "agent://stream";

#[tauri::command]
pub async fn agent_send_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: SendMessageRequest,
) -> AppResult<SendMessageResponse> {
    let store = store_for(&state, &req.workspace_path)?;
    let run_id = Uuid::new_v4().to_string();
    let cancel = CancelToken::new();
    state.register_agent_run(run_id.clone(), cancel.clone());

    let convo = {
        let store_c = store.clone();
        let cid = req.conversation_id.clone();
        tokio::task::spawn_blocking(move || store_c.get_conversation(&cid))
            .await
            .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
            .map_err(map_agent)?
            .ok_or_else(|| AppError::Internal("conversation not found".into()))?
    };

    // Persist user turn before kicking off the stream so a crash mid-stream
    // doesn't lose the user's input.
    let user_msg = Message {
        role: Role::User,
        content: req.user_text.clone(),
        tool_call_id: None,
    };
    {
        let store_c = store.clone();
        let user_msg = user_msg.clone();
        let cid = req.conversation_id.clone();
        tokio::task::spawn_blocking(move || store_c.append_message(&cid, &user_msg, None))
            .await
            .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
            .map_err(map_agent)?;
    }

    let provider = build_provider(&convo.provider, req.base_url.as_deref()).await?;
    let history = {
        let store_c = store.clone();
        let cid = req.conversation_id.clone();
        tokio::task::spawn_blocking(move || store_c.get_messages(&cid))
            .await
            .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
            .map_err(map_agent)?
    };

    let messages: Vec<Message> = history
        .into_iter()
        .filter(|m| m.role != "system")
        .map(|m| Message {
            role: match m.role.as_str() {
                "user" => Role::User,
                "assistant" => Role::Assistant,
                "tool" => Role::Tool,
                _ => Role::User,
            },
            content: m.content,
            tool_call_id: m.tool_call_id,
        })
        .collect();

    let completion = CompletionRequest {
        model: convo.model.clone(),
        messages,
        system: req.system_prompt,
        max_tokens: 4096,
        temperature: req.temperature,
    };

    let app_handle = app.clone();
    let run_id_bg = run_id.clone();
    let convo_id = req.conversation_id.clone();

    tokio::spawn(async move {
        let _ = app_handle.emit(
            STREAM_EVENT,
            StreamPayload::Started {
                run_id: run_id_bg.clone(),
                conversation_id: convo_id.clone(),
            },
        );

        let mut stream = provider.stream(completion);
        let mut accumulated = String::new();
        let mut error: Option<String> = None;
        let mut cancelled = false;

        loop {
            tokio::select! {
                () = cancel.cancelled() => {
                    cancelled = true;
                    break;
                }
                next = stream.next() => {
                    match next {
                        Some(Ok(StreamEvent::Delta { text })) => {
                            accumulated.push_str(&text);
                            let _ = app_handle.emit(
                                STREAM_EVENT,
                                StreamPayload::Delta {
                                    run_id: run_id_bg.clone(),
                                    text,
                                },
                            );
                        }
                        Some(Ok(StreamEvent::Warning { message })) => {
                            let _ = app_handle.emit(
                                STREAM_EVENT,
                                StreamPayload::Warning {
                                    run_id: run_id_bg.clone(),
                                    message,
                                },
                            );
                        }
                        Some(Ok(StreamEvent::Done { .. })) | None => break,
                        Some(Err(e)) => {
                            error = Some(format!("{e}"));
                            break;
                        }
                    }
                }
            }
        }

        app_handle.state::<AppState>().drop_agent_run(&run_id_bg);

        if cancelled {
            // Persist whatever the assistant produced before cancel so the
            // user keeps the partial answer in history.
            if !accumulated.is_empty() {
                let assistant_msg = Message {
                    role: Role::Assistant,
                    content: accumulated,
                    tool_call_id: None,
                };
                let store_c = store.clone();
                let cid = convo_id.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    store_c.append_message(&cid, &assistant_msg, None)
                })
                .await;
            }
            let _ = app_handle.emit(
                STREAM_EVENT,
                StreamPayload::Cancelled {
                    run_id: run_id_bg.clone(),
                },
            );
            return;
        }

        if let Some(msg) = error {
            let _ = app_handle.emit(
                STREAM_EVENT,
                StreamPayload::Error {
                    run_id: run_id_bg.clone(),
                    message: msg,
                },
            );
            return;
        }

        if accumulated.is_empty() {
            let _ = app_handle.emit(
                STREAM_EVENT,
                StreamPayload::Done {
                    run_id: run_id_bg,
                    message_id: String::new(),
                },
            );
            return;
        }

        let assistant_msg = Message {
            role: Role::Assistant,
            content: accumulated,
            tool_call_id: None,
        };
        let store_c = store.clone();
        let cid = convo_id.clone();
        let persist_result =
            tokio::task::spawn_blocking(move || store_c.append_message(&cid, &assistant_msg, None))
                .await;
        let payload = match persist_result {
            Ok(Ok(id)) => StreamPayload::Done {
                run_id: run_id_bg,
                message_id: id,
            },
            Ok(Err(e)) => StreamPayload::Error {
                run_id: run_id_bg,
                message: format!("persist assistant: {e}"),
            },
            Err(e) => StreamPayload::Error {
                run_id: run_id_bg,
                message: format!("persist join: {e}"),
            },
        };
        let _ = app_handle.emit(STREAM_EVENT, payload);
    });

    Ok(SendMessageResponse { run_id })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRequest {
    pub run_id: String,
}

#[tauri::command]
pub async fn agent_cancel(state: State<'_, AppState>, req: CancelRequest) -> AppResult<bool> {
    Ok(state.cancel_agent_run(&req.run_id))
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
    let old_text = read_file_at(&path).await?;
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
        .peek_pending_edit(id)
        .ok_or_else(|| AppError::Internal(format!("unknown proposal_id: {}", req.proposal_id)))?;
    let final_text = apply_accepted_hunks(
        &proposal.old_text,
        &proposal.hunks,
        &req.accepted_hunk_indices,
    );
    write_file_at(&proposal.path, &final_text).await?;
    let _ = state.take_pending_edit(id);
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
    state
        .indexer_get_or_init(workspace, |normalised| {
            let db_path = db_path_for(normalised);
            Indexer::new(normalised, &db_path).map_err(|e| format!("agent: {e}"))
        })
        .map_err(AppError::Internal)
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
