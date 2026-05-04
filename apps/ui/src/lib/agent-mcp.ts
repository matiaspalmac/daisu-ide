import { invoke } from "@tauri-apps/api/core";

export type McpTransport = "stdio" | "sse";

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  url?: string | undefined;
  enabled: boolean;
}

export interface McpStatusInfo {
  name: string;
  connected: boolean;
  toolCount: number;
}

export interface McpToolInfo {
  server: string;
  name: string;
  description: string | null;
  schema: unknown;
}

export interface McpToolResult {
  content: unknown[];
  isError: boolean;
}

export function mcpConnect(config: McpServerConfig): Promise<McpStatusInfo> {
  return invoke<McpStatusInfo>("agent_mcp_connect", { req: { config } });
}

export function mcpDisconnect(name: string): Promise<boolean> {
  return invoke<boolean>("agent_mcp_disconnect", { req: { name } });
}

export function mcpStatus(): Promise<McpStatusInfo[]> {
  return invoke<McpStatusInfo[]>("agent_mcp_status");
}

export function mcpListTools(serverName?: string): Promise<McpToolInfo[]> {
  return invoke<McpToolInfo[]>("agent_mcp_list_tools", {
    req: { serverName: serverName ?? null },
  });
}

export function mcpCallTool(
  server: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResult> {
  return invoke<McpToolResult>("agent_mcp_call_tool", {
    req: { server, tool, arguments: args },
  });
}
