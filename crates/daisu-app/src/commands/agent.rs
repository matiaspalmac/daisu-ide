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
    clippy::too_many_lines,
    clippy::match_same_arms,
    clippy::unused_async
)]

use std::path::PathBuf;
use std::sync::Arc;

use daisu_agent::{
    keychain,
    memory::{ConversationSummary, MemoryStore, StoredMessage},
    provider::{anthropic::AnthropicProvider, ollama::OllamaProvider, ProviderId, ToolCapability},
    runtime::CancelToken,
    AgentResult, CompletionRequest, LlmProvider, Message, Role, StreamEvent,
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
    Started { run_id: String, message_id: String },
    Delta { run_id: String, text: String },
    Warning { run_id: String, message: String },
    Done { run_id: String, message_id: String },
    Error { run_id: String, message: String },
    Cancelled { run_id: String },
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
                message_id: convo_id.clone(),
            },
        );

        let mut stream = provider.stream(completion);
        let mut accumulated = String::new();
        let mut error: Option<String> = None;

        loop {
            tokio::select! {
                () = cancel.cancelled() => {
                    let _ = app_handle.emit(
                        STREAM_EVENT,
                        StreamPayload::Cancelled { run_id: run_id_bg.clone() },
                    );
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
            return;
        }

        let assistant_msg = Message {
            role: Role::Assistant,
            content: accumulated,
            tool_call_id: None,
        };
        let store_c = store.clone();
        let cid = convo_id.clone();
        let id =
            tokio::task::spawn_blocking(move || store_c.append_message(&cid, &assistant_msg, None))
                .await
                .ok()
                .and_then(Result::ok)
                .unwrap_or_default();

        let _ = app_handle.emit(
            STREAM_EVENT,
            StreamPayload::Done {
                run_id: run_id_bg,
                message_id: id,
            },
        );
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
