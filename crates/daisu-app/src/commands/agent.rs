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
use std::sync::Arc;

use daisu_agent::{
    index::{IndexStatus, Indexer, SymbolHit},
    keychain,
    memory::{ConversationSummary, MemoryStore, StoredMessage},
    permission::gate::PERMISSION_REQUEST_EVENT,
    provider::{anthropic::AnthropicProvider, ollama::OllamaProvider, ProviderId, ToolCapability},
    runtime::CancelToken,
    AgentResult, AllowlistEntry, CompletionRequest, Decision, EventEmitter, LlmProvider, Message,
    PermissionGate, PermissionRequestEvent, Role, StreamEvent, ToolCall, ToolDescriptor,
    ToolResult,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

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

    let provider = build_provider_with_fallback(&convo.provider, req.base_url.as_deref()).await?;
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

async fn build_provider_with_fallback(
    provider: &str,
    base_url: Option<&str>,
) -> AppResult<Box<dyn LlmProvider>> {
    build_provider(provider, base_url).await
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
