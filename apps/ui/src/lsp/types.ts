// Minimal TypeScript mirrors of the LSP types we exchange across the
// Tauri bridge. Hand-rolled (instead of depending on
// `vscode-languageserver-types`) so we avoid pulling VSCode internals
// into the bundle. Shapes match LSP 3.17.

export interface LspPosition {
  /** 0-based line number. */
  line: number;
  /** 0-based UTF-16 code-unit offset within the line. */
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspLocationLink {
  originSelectionRange?: LspRange;
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange: LspRange;
}

export type LspGotoDefinitionResponse =
  | LspLocation
  | LspLocation[]
  | LspLocationLink[];

export interface LspDocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  tags?: number[];
  deprecated?: boolean;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

export interface LspSymbolInformation {
  name: string;
  kind: number;
  tags?: number[];
  deprecated?: boolean;
  location: LspLocation;
  containerName?: string;
}

export type LspDocumentSymbolResponse =
  | LspDocumentSymbol[]
  | LspSymbolInformation[];

export interface LspWorkspaceSymbol {
  name: string;
  kind: number;
  tags?: number[];
  containerName?: string;
  /** Newer spec allows the location to be a bare `{ uri }` and resolve later. */
  location: LspLocation | { uri: string };
  data?: unknown;
}

export type LspWorkspaceSymbolResponse =
  | LspSymbolInformation[]
  | LspWorkspaceSymbol[];

export const LspSymbolKind = {
  File: 1, Module: 2, Namespace: 3, Package: 4, Class: 5,
  Method: 6, Property: 7, Field: 8, Constructor: 9, Enum: 10,
  Interface: 11, Function: 12, Variable: 13, Constant: 14, String: 15,
  Number: 16, Boolean: 17, Array: 18, Object: 19, Key: 20,
  Null: 21, EnumMember: 22, Struct: 23, Event: 24, Operator: 25,
  TypeParameter: 26,
} as const;
