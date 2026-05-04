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

use daisu_agent::{
    keychain,
    provider::{anthropic::AnthropicProvider, ollama::OllamaProvider, ProviderId, ToolCapability},
    AgentResult, CompletionRequest, LlmProvider, McpServerConfig, McpToolResult, Message, Role,
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

use crate::error::{AppError, AppResult};
use crate::AppState;

/// Tauri event emitted when an MCP server connect attempt succeeds or fails.
const MCP_STATUS_EVENT: &str = "agent://mcp-status";

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
    state: State<'_, AppState>,
    req: McpDisconnectRequest,
) -> AppResult<bool> {
    Ok(state.mcp_registry.disconnect(&req.name).await)
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
