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

export interface MutationCapabilities {
  rename: boolean;
  prepareRename: boolean;
  documentFormatting: boolean;
  rangeFormatting: boolean;
}

export interface AdvancedCapabilities {
  inlayHint: boolean;
  inlayHintResolve: boolean;
  semanticTokensFull: boolean;
  codeAction: boolean;
  codeActionResolve: boolean;
  executeCommand: boolean;
}

export interface ServerStatus {
  serverId: string;
  languages: string[];
  resolution: { kind: "found"; path: string } | { kind: "missing" };
  state: "idle" | "spawning" | "ready" | "crashed";
  rssMb: number | null;
  capabilities: NavCapabilities;
  mutation: MutationCapabilities;
  advanced: AdvancedCapabilities;
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

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

export interface LspAnnotatedTextEdit extends LspTextEdit {
  annotationId?: string;
}

export interface LspOptionalVersionedTextDocumentIdentifier {
  uri: string;
  version: number | null;
}

export interface LspTextDocumentEdit {
  textDocument: LspOptionalVersionedTextDocumentIdentifier;
  edits: LspTextEdit[];
}

export interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: LspTextDocumentEdit[];
}

export type LspPrepareRenameResponse =
  | LspRange
  | { range: LspRange; placeholder: string }
  | { defaultBehavior: boolean }
  | null;

export function lspPrepareRename(
  path: string,
  line: number,
  character: number,
  serverId?: string,
): Promise<LspPrepareRenameResponse> {
  return invoke<LspPrepareRenameResponse>("lsp_prepare_rename", {
    req: { path, line, character, serverId },
  });
}

export function lspRename(
  path: string,
  line: number,
  character: number,
  newName: string,
  serverId?: string,
): Promise<LspWorkspaceEdit | null> {
  return invoke<LspWorkspaceEdit | null>("lsp_rename", {
    req: { path, line, character, newName, serverId },
  });
}

export function lspFormatting(
  path: string,
  tabSize: number,
  insertSpaces: boolean,
  serverId?: string,
): Promise<LspTextEdit[]> {
  return invoke<LspTextEdit[]>("lsp_formatting", {
    req: { path, serverId, tabSize, insertSpaces },
  });
}

export function lspRangeFormatting(
  path: string,
  range: LspRange,
  tabSize: number,
  insertSpaces: boolean,
  serverId?: string,
): Promise<LspTextEdit[]> {
  return invoke<LspTextEdit[]>("lsp_range_formatting", {
    req: {
      path,
      serverId,
      startLine: range.start.line,
      startCharacter: range.start.character,
      endLine: range.end.line,
      endCharacter: range.end.character,
      tabSize,
      insertSpaces,
    },
  });
}

// === M4.3 advanced types ===

export interface LspInlayHintLabelPart {
  value: string;
  tooltip?: string | { kind: "markdown" | "plaintext"; value: string };
  location?: { uri: string; range: LspRange };
  command?: { title: string; command: string; arguments?: unknown[] };
}

export interface LspInlayHint {
  position: LspPosition;
  label: string | LspInlayHintLabelPart[];
  kind?: 1 | 2;
  textEdits?: LspTextEdit[];
  tooltip?: string | { kind: "markdown" | "plaintext"; value: string };
  paddingLeft?: boolean;
  paddingRight?: boolean;
  data?: unknown;
}

export interface LspSemanticTokens {
  resultId?: string;
  data: number[];
}

export type LspSemanticTokensResult = LspSemanticTokens | { edits: unknown[] } | null;

export interface LspCodeAction {
  title: string;
  kind?: string;
  diagnostics?: LspDiagnostic[];
  isPreferred?: boolean;
  disabled?: { reason: string };
  edit?: LspWorkspaceEdit;
  command?: { title: string; command: string; arguments?: unknown[] };
  data?: unknown;
}

export interface LspCommand {
  title: string;
  command: string;
  arguments?: unknown[];
}

export type LspCodeActionOrCommand = LspCodeAction | LspCommand;

export function lspInlayHint(
  path: string,
  range: LspRange,
  serverId?: string,
): Promise<LspInlayHint[]> {
  return invoke<LspInlayHint[]>("lsp_inlay_hint", {
    req: {
      path,
      serverId,
      startLine: range.start.line,
      startCharacter: range.start.character,
      endLine: range.end.line,
      endCharacter: range.end.character,
    },
  });
}

export function lspInlayHintResolve(
  serverId: string,
  hint: LspInlayHint,
): Promise<LspInlayHint | null> {
  return invoke<LspInlayHint | null>("lsp_inlay_hint_resolve", {
    req: { serverId, hint },
  });
}

export function lspSemanticTokens(
  path: string,
  serverId?: string,
): Promise<LspSemanticTokensResult> {
  return invoke<LspSemanticTokensResult>("lsp_semantic_tokens", {
    req: { path, line: 0, character: 0, serverId },
  });
}

export function lspCodeAction(
  path: string,
  range: LspRange,
  diagnostics: LspDiagnostic[],
  serverId?: string,
): Promise<LspCodeActionOrCommand[]> {
  return invoke<LspCodeActionOrCommand[]>("lsp_code_action", {
    req: {
      path,
      serverId,
      startLine: range.start.line,
      startCharacter: range.start.character,
      endLine: range.end.line,
      endCharacter: range.end.character,
      diagnostics,
    },
  });
}

export function lspCodeActionResolve(
  serverId: string,
  action: LspCodeAction,
): Promise<LspCodeAction | null> {
  return invoke<LspCodeAction | null>("lsp_code_action_resolve", {
    req: { serverId, action },
  });
}

export function lspExecuteCommand(
  serverId: string,
  command: string,
  args: unknown[] = [],
): Promise<unknown> {
  return invoke<unknown>("lsp_execute_command", {
    req: { serverId, command, arguments: args },
  });
}
