import type * as monacoNs from "monaco-editor";
import { lspSemanticTokens, type LspSemanticTokensResult } from "../lib/lsp";
import { flushPendingChange, pathOfModel } from "./monacoBridge";

export interface SemanticTokensLegend {
  tokenTypes: string[];
  tokenModifiers: string[];
}

export interface SemanticTokensAdapterOpts {
  serverId: string;
  legend: SemanticTokensLegend;
}

/**
 * Build a Monaco DocumentSemanticTokensProvider. LSP encodes tokens as a
 * flat `Vec<u32>` of 5-tuples (deltaLine, deltaStart, length, tokenType,
 * tokenModifiers) — Monaco accepts the **same encoding** when returned
 * via `provideDocumentSemanticTokens`, so this is a passthrough adapter.
 *
 * Defer delta-encoding (`textDocument/semanticTokens/full/delta`) to
 * M4.x. Always send a full snapshot.
 */
export function makeSemanticTokensProvider(
  opts: SemanticTokensAdapterOpts,
): monacoNs.languages.DocumentSemanticTokensProvider {
  return {
    getLegend: () => opts.legend,
    async provideDocumentSemanticTokens(model) {
      const path = pathOfModel(model);
      if (!path) return null;
      await flushPendingChange(path);
      const result = await lspSemanticTokens(path, opts.serverId).catch(
        () => null as LspSemanticTokensResult,
      );
      if (!result || !("data" in result)) return null;
      const data = new Uint32Array(result.data);
      return result.resultId
        ? ({ resultId: result.resultId, data } as monacoNs.languages.SemanticTokens)
        : ({ data } as monacoNs.languages.SemanticTokens);
    },
    releaseDocumentSemanticTokens: () => undefined,
  };
}

