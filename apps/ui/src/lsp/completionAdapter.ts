import type * as monaco from "monaco-editor";
import {
  lspCompletion,
  lspCompletionResolve,
  type LspCompletionItem,
  type LspCompletionResponse,
} from "../lib/lsp";
import { pathOfModel } from "./monacoBridge";

const KIND_MAP: Record<number, number> = {
  1: 17,
  2: 0,
  3: 1,
  4: 2,
  5: 3,
  6: 4,
  7: 5,
  8: 6,
  9: 7,
  10: 8,
};

function toMonacoKind(kind?: number): number {
  if (kind === undefined) return 17;
  return KIND_MAP[kind] ?? 17;
}

export function makeCompletionProvider(
  editor: typeof import("monaco-editor"),
  serverId: string,
): monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: [".", ":", ">", "/", "@", "#"],
    async provideCompletionItems(model, position) {
      const path = pathOfModel(model);
      if (!path) return { suggestions: [] };
      const res: LspCompletionResponse = await lspCompletion(
        path,
        position.lineNumber - 1,
        position.column - 1,
        serverId,
      );
      if (!res) return { suggestions: [] };
      const items: LspCompletionItem[] = Array.isArray(res) ? res : res.items;
      const word = model.getWordUntilPosition(position);
      const range = new editor.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      return {
        suggestions: items.map((it) => ({
          label: it.label,
          kind: toMonacoKind(it.kind) as monaco.languages.CompletionItemKind,
          detail: it.detail,
          documentation:
            typeof it.documentation === "string"
              ? it.documentation
              : it.documentation?.value,
          insertText: it.insertText ?? it.label,
          insertTextRules: (it.insertTextFormat === 2
            ? 4
            : 0) as monaco.languages.CompletionItemInsertTextRule,
          range,
          ...(it.data !== undefined ? { _lspData: it.data } : {}),
        })) as monaco.languages.CompletionItem[],
      };
    },
    async resolveCompletionItem(item) {
      const lsp: LspCompletionItem = {
        label: typeof item.label === "string" ? item.label : item.label.label,
      };
      if (item.detail !== undefined) lsp.detail = item.detail;
      const itemDoc =
        typeof item.documentation === "string"
          ? item.documentation
          : (item.documentation as { value: string } | undefined)?.value;
      if (itemDoc !== undefined) lsp.documentation = itemDoc;
      if (typeof item.insertText === "string") lsp.insertText = item.insertText;
      const data = (item as unknown as { _lspData?: unknown })._lspData;
      if (data !== undefined) lsp.data = data;
      const resolved = await lspCompletionResolve(serverId, lsp);
      const out: monaco.languages.CompletionItem = { ...item };
      if (resolved.detail !== undefined) out.detail = resolved.detail;
      else if (item.detail !== undefined) out.detail = item.detail;
      const resolvedDoc =
        typeof resolved.documentation === "string"
          ? resolved.documentation
          : resolved.documentation?.value;
      if (resolvedDoc !== undefined) out.documentation = resolvedDoc;
      return out;
    },
  };
}
