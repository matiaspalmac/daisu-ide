// Typed wrappers for the M3 Phase 4 symbol-index Tauri commands.
//
// All commands take a workspace path and operate against a per-workspace
// SQLite FTS5 store under `<workspace>/.daisu/symbols.db`. The wrappers below
// hide the camelCase/snake_case payload conversion that Tauri's invoke layer
// would otherwise leak into call sites.

import { invoke } from "@tauri-apps/api/core";

export type SymbolKind =
  | "function"
  | "method"
  | "struct"
  | "class"
  | "interface"
  | "enum"
  | "type"
  | "trait"
  | "module"
  | "const";

export interface SymbolHit {
  name: string;
  kind: SymbolKind;
  path: string;
  lineStart: number;
  lineEnd: number;
  signature: string | null;
}

export interface IndexRebuildResponse {
  indexed: number;
  durationMs: number;
}

export interface IndexStatus {
  symbols: number;
  lastRebuild: number | null;
}

export function indexRebuild(
  workspacePath: string,
): Promise<IndexRebuildResponse> {
  return invoke<IndexRebuildResponse>("agent_index_rebuild", {
    req: { workspacePath },
  });
}

export function indexSearch(
  workspacePath: string,
  query: string,
  limit = 50,
): Promise<SymbolHit[]> {
  return invoke<SymbolHit[]>("agent_index_search", {
    req: { workspacePath, query, limit },
  });
}

export function indexStatus(workspacePath: string): Promise<IndexStatus> {
  return invoke<IndexStatus>("agent_index_status", {
    req: { workspacePath },
  });
}
