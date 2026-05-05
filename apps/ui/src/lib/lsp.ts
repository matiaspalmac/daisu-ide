import { invoke } from "@tauri-apps/api/core";
import type {
  LspGotoDefinitionResponse,
  LspLocation,
  LspDocumentSymbolResponse,
  LspWorkspaceSymbolResponse,
} from "../lsp/types";

export interface TrustState {
  trusted: boolean;
}

export interface NavCapabilities {
  definition: boolean;
  references: boolean;
  documentSymbol: boolean;
  workspaceSymbol: boolean;
}

export interface ServerStatus {
  serverId: string;
  languages: string[];
  resolution: { kind: "found"; path: string } | { kind: "missing" };
  state: "idle" | "spawning" | "ready" | "crashed";
  rssMb: number | null;
  capabilities: NavCapabilities;
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

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  severity?: 1 | 2 | 3 | 4;
  code?: string | number;
  source?: string;
  message: string;
}

export interface LspDiagnosticEvent {
  uri: string;
  version: number | null;
  serverId: string;
  diagnostics: LspDiagnostic[];
}

export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: "plaintext" | "markdown"; value: string };
  insertText?: string;
  insertTextFormat?: 1 | 2;
  textEdit?: { range: LspRange; newText: string };
  data?: unknown;
}

export interface LspCompletionList {
  isIncomplete: boolean;
  items: LspCompletionItem[];
}

export type LspCompletionResponse = LspCompletionItem[] | LspCompletionList | null;

export interface LspHover {
  contents:
    | { kind: "plaintext" | "markdown"; value: string }
    | Array<string | { language: string; value: string }>
    | string;
  range?: LspRange;
}

export interface LspSignatureInformation {
  label: string;
  documentation?: string | { kind: "plaintext" | "markdown"; value: string };
  parameters?: Array<{
    label: string | [number, number];
    documentation?: string | { kind: "plaintext" | "markdown"; value: string };
  }>;
  activeParameter?: number;
}

export interface LspSignatureHelp {
  signatures: LspSignatureInformation[];
  activeSignature?: number;
  activeParameter?: number;
}

export function documentOpen(path: string, text: string): Promise<void> {
  return invoke<void>("lsp_document_open", { req: { path, text } });
}

export function documentChange(path: string, text: string): Promise<void> {
  return invoke<void>("lsp_document_change", { req: { path, text } });
}

export function documentClose(path: string): Promise<void> {
  return invoke<void>("lsp_document_close", { req: { path } });
}

export function lspCompletion(
  path: string,
  line: number,
  character: number,
  serverId?: string,
): Promise<LspCompletionResponse> {
  return invoke<LspCompletionResponse>("lsp_completion", {
    req: { path, line, character, serverId },
  });
}

export function lspCompletionResolve(
  serverId: string,
  item: LspCompletionItem,
): Promise<LspCompletionItem> {
  return invoke<LspCompletionItem>("lsp_completion_resolve", { serverId, item });
}

export function lspHover(
  path: string,
  line: number,
  character: number,
  serverId?: string,
): Promise<LspHover | null> {
  return invoke<LspHover | null>("lsp_hover", {
    req: { path, line, character, serverId },
  });
}

export function lspSignatureHelp(
  path: string,
  line: number,
  character: number,
  serverId?: string,
): Promise<LspSignatureHelp | null> {
  return invoke<LspSignatureHelp | null>("lsp_signature_help", {
    req: { path, line, character, serverId },
  });
}

export function lspDefinition(
  path: string,
  line: number,
  character: number,
  serverId?: string,
): Promise<LspGotoDefinitionResponse | null> {
  return invoke<LspGotoDefinitionResponse | null>("lsp_definition", {
    req: { path, line, character, serverId },
  });
}

export function lspReferences(
  path: string,
  line: number,
  character: number,
  includeDeclaration: boolean,
  serverId?: string,
): Promise<LspLocation[]> {
  return invoke<LspLocation[]>("lsp_references", {
    req: { path, line, character, serverId, includeDeclaration },
  });
}

export function lspDocumentSymbol(
  path: string,
  serverId?: string,
): Promise<LspDocumentSymbolResponse | null> {
  return invoke<LspDocumentSymbolResponse | null>("lsp_document_symbol", {
    req: { path, serverId },
  });
}

export function lspWorkspaceSymbol(
  query: string,
  serverId: string,
): Promise<LspWorkspaceSymbolResponse | null> {
  return invoke<LspWorkspaceSymbolResponse | null>("lsp_workspace_symbol", {
    req: { query, serverId },
  });
}
