import { invoke } from "@tauri-apps/api/core";

export type AgentProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "ollama"
  | "lmstudio";

export interface AgentProviderInfo {
  id: AgentProviderId;
  name: string;
  requiresKey: boolean;
  hasKey: boolean;
  supportsTools: boolean;
  supportsParallelTools: boolean;
  implemented: boolean;
}

export interface ProviderTestRequest {
  provider: AgentProviderId;
  model: string;
  baseUrl?: string;
}

export interface ProviderTestResponse {
  ok: boolean;
  model: string;
  sample: string;
  latencyMs: number;
}

export function listProviders(): Promise<AgentProviderInfo[]> {
  return invoke<
    Array<{
      id: string;
      name: string;
      requires_key: boolean;
      has_key: boolean;
      supports_tools: boolean;
      supports_parallel_tools: boolean;
      implemented: boolean;
    }>
  >("agent_provider_list").then((rows) =>
    rows.map((r) => ({
      id: r.id as AgentProviderId,
      name: r.name,
      requiresKey: r.requires_key,
      hasKey: r.has_key,
      supportsTools: r.supports_tools,
      supportsParallelTools: r.supports_parallel_tools,
      implemented: r.implemented,
    })),
  );
}

export function setProviderKey(
  provider: AgentProviderId,
  secret: string,
): Promise<void> {
  return invoke("agent_key_set", { provider, secret });
}

export function clearProviderKey(provider: AgentProviderId): Promise<void> {
  return invoke("agent_key_clear", { provider });
}

export function hasProviderKey(provider: AgentProviderId): Promise<boolean> {
  return invoke<boolean>("agent_key_has", { provider });
}

export function testProvider(
  req: ProviderTestRequest,
): Promise<ProviderTestResponse> {
  return invoke<ProviderTestResponse>("agent_provider_test", { req });
}

// ----------------------------------------------------------------------------
// Phase 1 — conversations + streaming
// ----------------------------------------------------------------------------

export interface ConversationSummary {
  id: string;
  title: string;
  provider: string;
  model: string;
  created_at: number;
  updated_at: number;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string | null;
  created_at: number;
}

export function createConversation(
  workspacePath: string,
  title: string,
  provider: AgentProviderId,
  model: string,
): Promise<string> {
  return invoke<{ id: string }>("agent_create_conversation", {
    req: { workspacePath, title, provider, model },
  }).then((r) => r.id);
}

export function listConversations(
  workspacePath: string,
): Promise<ConversationSummary[]> {
  return invoke<ConversationSummary[]>("agent_list_conversations", {
    req: { workspacePath },
  });
}

export function getMessages(
  workspacePath: string,
  conversationId: string,
): Promise<StoredMessage[]> {
  return invoke<StoredMessage[]>("agent_get_messages", {
    req: { workspacePath, conversationId },
  });
}

export function deleteConversation(
  workspacePath: string,
  conversationId: string,
): Promise<void> {
  return invoke("agent_delete_conversation", {
    req: { workspacePath, conversationId },
  });
}

export interface SendMessageOptions {
  workspacePath: string;
  conversationId: string;
  userText: string;
  systemPrompt?: string;
  baseUrl?: string;
  temperature?: number;
}

export function sendMessage(opts: SendMessageOptions): Promise<string> {
  return invoke<{ runId: string }>("agent_send_message", { req: opts }).then(
    (r) => r.runId,
  );
}

export function cancelRun(runId: string): Promise<boolean> {
  return invoke<boolean>("agent_cancel", { req: { runId } });
}

export type StreamPayload =
  | { type: "started"; runId: string; messageId: string }
  | { type: "delta"; runId: string; text: string }
  | { type: "warning"; runId: string; message: string }
  | { type: "done"; runId: string; messageId: string }
  | { type: "error"; runId: string; message: string }
  | { type: "cancelled"; runId: string };

export const AGENT_STREAM_EVENT = "agent://stream";
