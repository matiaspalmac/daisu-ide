import type { LspPosition, LspRange } from "./types";

export interface MonacoPosition {
  lineNumber: number;
  column: number;
}

export interface MonacoRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

// LSP and Monaco both index columns in UTF-16 code units. The only
// difference is 0-based (LSP) vs 1-based (Monaco) — no byte conversion
// is needed for navigation.

export const lspPositionToMonaco = (p: LspPosition): MonacoPosition => ({
  lineNumber: p.line + 1,
  column: p.character + 1,
});

export const lspRangeToMonaco = (r: LspRange): MonacoRange => ({
  startLineNumber: r.start.line + 1,
  startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1,
  endColumn: r.end.character + 1,
});
