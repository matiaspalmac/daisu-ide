import { invoke } from "@tauri-apps/api/core";

export interface TrustState {
  trusted: boolean;
}

export interface ServerStatus {
  serverId: string;
  languages: string[];
  resolution: { kind: "found"; path: string } | { kind: "missing" };
  state: "idle" | "spawning" | "ready" | "crashed";
  rssMb: number | null;
}

export function isWorkspaceTrusted(workspacePath: string): Promise<TrustState> {
  return invoke<TrustState>("lsp_workspace_is_trusted", {
    req: { workspacePath },
  });
}

export function trustWorkspace(workspacePath: string): Promise<TrustState> {
  return invoke<TrustState>("lsp_workspace_trust", {
    req: { workspacePath },
  });
}

export function revokeWorkspace(workspacePath: string): Promise<TrustState> {
  return invoke<TrustState>("lsp_workspace_revoke", {
    req: { workspacePath },
  });
}

export function listServerStatus(): Promise<ServerStatus[]> {
  return invoke<ServerStatus[]>("lsp_servers_status");
}
