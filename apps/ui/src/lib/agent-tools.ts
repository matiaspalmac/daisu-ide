import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PermissionTier = "auto" | "prompt" | "sandbox";

export type Decision =
  | "allowonce"
  | "allowalways"
  | "deny"
  | "denyalways";

export interface ToolDescriptor {
  name: string;
  description: string;
  tier: PermissionTier;
}

export interface ToolDispatchRequest {
  tool: string;
  arguments: unknown;
  scope: string;
  workspacePath: string;
}

export type ToolResult =
  | { kind: "ok"; fields: unknown }
  | { kind: "denied"; reason: string }
  | { kind: "error"; fields: string };

export interface PermissionRequestPayload {
  request_id: string;
  tool_name: string;
  scope: string;
  tier: PermissionTier;
  summary: string;
}

export interface AllowlistEntry {
  tool_name: string;
  scope_glob: string;
  decision: string;
  created_at: number;
}

export const PERMISSION_REQUEST_EVENT = "agent://permission-request";

export function listAgentTools(): Promise<ToolDescriptor[]> {
  return invoke<ToolDescriptor[]>("agent_tool_list");
}

export function dispatchAgentTool(
  req: ToolDispatchRequest,
): Promise<ToolResult> {
  return invoke<ToolResult>("agent_tool_dispatch", { req });
}

export function resolvePermission(req: {
  workspacePath: string;
  requestId: string;
  decision: Decision;
}): Promise<boolean> {
  return invoke<boolean>("agent_permission_resolve", { req });
}

export function listAllowlist(workspacePath: string): Promise<AllowlistEntry[]> {
  return invoke<AllowlistEntry[]>("agent_permission_list_allowlist", {
    req: { workspacePath },
  });
}

export function clearAllowlist(
  workspacePath: string,
  toolName?: string,
): Promise<number> {
  return invoke<number>("agent_permission_clear_allowlist", {
    req: { workspacePath, toolName: toolName ?? null },
  });
}

export function listenForPermissionRequests(
  callback: (payload: PermissionRequestPayload) => void,
): Promise<UnlistenFn> {
  return listen<PermissionRequestPayload>(
    PERMISSION_REQUEST_EVENT,
    (event) => callback(event.payload),
  );
}
