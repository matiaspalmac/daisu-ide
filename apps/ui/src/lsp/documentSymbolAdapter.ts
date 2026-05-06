import type * as monaco from "monaco-editor";
import { lspDocumentSymbol } from "../lib/lsp";
import { pathOfModel } from "./monacoBridge";
import { lspRangeToMonaco } from "./positions";
import type {
  LspDocumentSymbol,
  LspDocumentSymbolResponse,
  LspSymbolInformation,
} from "./types";

export function makeDocumentSymbolProvider(
  serverId: string,
): monaco.languages.DocumentSymbolProvider {
  return {
    displayName: "Daisu LSP",
    async provideDocumentSymbols(model, token) {
      const path = pathOfModel(model);
      if (!path) return [];
      const res = await lspDocumentSymbol(path, serverId).catch(() => null);
      if (!res || token.isCancellationRequested) return [];
      return normalizeDocSymbolResponse(res);
    },
  };
}

function normalizeDocSymbolResponse(
  r: LspDocumentSymbolResponse,
): monaco.languages.DocumentSymbol[] {
  if (r.length === 0) return [];
  // Discriminate Nested (DocumentSymbol — has selectionRange) from Flat
  // (SymbolInformation — has location).
  if (isNested(r[0]!)) {
    return (r as LspDocumentSymbol[]).map(toMonacoFromNested);
  }
  return (r as LspSymbolInformation[]).map(toMonacoFromFlat);
}

function isNested(
  x: LspDocumentSymbol | LspSymbolInformation,
): x is LspDocumentSymbol {
  return "selectionRange" in x;
}

function toMonacoFromNested(s: LspDocumentSymbol): monaco.languages.DocumentSymbol {
  return {
    name: s.name,
    detail: s.detail ?? "",
    // LSP SymbolKind is 1-based; Monaco's enum is 0-based.
    kind: (s.kind - 1) as monaco.languages.SymbolKind,
    tags: (s.tags ?? []) as monaco.languages.SymbolTag[],
    range: lspRangeToMonaco(s.range),
    selectionRange: lspRangeToMonaco(s.selectionRange),
    children: s.children?.map(toMonacoFromNested) ?? [],
  };
}

function toMonacoFromFlat(s: LspSymbolInformation): monaco.languages.DocumentSymbol {
  const range = lspRangeToMonaco(s.location.range);
  return {
    name: s.name,
    detail: s.containerName ?? "",
    kind: (s.kind - 1) as monaco.languages.SymbolKind,
    tags: (s.tags ?? []) as monaco.languages.SymbolTag[],
    range,
    selectionRange: range,
    children: [],
  };
}
