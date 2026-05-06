import type * as monaco from "monaco-editor";
import { lspHover, type LspHover } from "../lib/lsp";
import { pathOfModel } from "./monacoBridge";

function hoverToMarkdown(h: LspHover): monaco.IMarkdownString[] {
  const c = h.contents;
  if (typeof c === "string") return [{ value: c }];
  if (Array.isArray(c)) {
    return c.map((part) =>
      typeof part === "string"
        ? { value: part }
        : { value: "```" + part.language + "\n" + part.value + "\n```" },
    );
  }
  return [{ value: c.value, isTrusted: false }];
}

export function makeHoverProvider(serverId: string): monaco.languages.HoverProvider {
  return {
    async provideHover(model, position) {
      const path = pathOfModel(model);
      if (!path) return null;
      const h = await lspHover(
        path,
        position.lineNumber - 1,
        position.column - 1,
        serverId,
      );
      if (!h) return null;
      const result: monaco.languages.Hover = {
        contents: hoverToMarkdown(h),
      };
      if (h.range) {
        result.range = {
          startLineNumber: h.range.start.line + 1,
          startColumn: h.range.start.character + 1,
          endLineNumber: h.range.end.line + 1,
          endColumn: h.range.end.character + 1,
        };
      }
      return result;
    },
  };
}
