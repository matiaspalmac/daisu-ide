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
    }>
  >("agent_provider_list").then((rows) =>
    rows.map((r) => ({
      id: r.id as AgentProviderId,
      name: r.name,
      requiresKey: r.requires_key,
      hasKey: r.has_key,
      supportsTools: r.supports_tools,
      supportsParallelTools: r.supports_parallel_tools,
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
