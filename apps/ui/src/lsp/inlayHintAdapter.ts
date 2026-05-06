import type * as monacoNs from "monaco-editor";
import {
  lspInlayHint,
  lspInlayHintResolve,
  type LspInlayHint,
  type LspInlayHintLabelPart,
} from "../lib/lsp";
import { lspPositionToMonaco, lspRangeToMonaco } from "./positions";
import { flushPendingChange } from "./monacoBridge";

const RESOLVE_KIND_TYPE = 1;

export interface InlayHintAdapterOpts {
  serverId: string;
  hasResolveProvider: boolean;
}

/** Build a Monaco-compatible InlayHintsProvider for a given server. */
export function makeInlayHintsProvider(
  opts: InlayHintAdapterOpts,
): monacoNs.languages.InlayHintsProvider {
  const base: monacoNs.languages.InlayHintsProvider = {
    async provideInlayHints(model, range) {
      const path = pathOf(model);
      await flushPendingChange(path);
      const hints = await lspInlayHint(
        path,
        {
          start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
          end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
        },
        opts.serverId,
      ).catch(() => [] as LspInlayHint[]);
      return {
        hints: hints.map((h) => toMonacoHint(h, opts.serverId)),
        dispose: () => undefined,
      };
    },
  };
  if (opts.hasResolveProvider) {
    base.resolveInlayHint = async (hint) => {
      const original = (hint as { __lspHint?: LspInlayHint }).__lspHint;
      if (!original) return hint;
      const resolved = await lspInlayHintResolve(opts.serverId, original).catch(
        () => null,
      );
      if (!resolved) return hint;
      return toMonacoHint(resolved, opts.serverId);
    };
  }
  return base;
}

function toMonacoHint(
  h: LspInlayHint,
  serverId: string,
): monacoNs.languages.InlayHint & { __lspHint?: LspInlayHint } {
  const label: monacoNs.languages.InlayHint["label"] = Array.isArray(h.label)
    ? h.label.map(toLabelPart)
    : h.label;
  return {
    position: lspPositionToMonaco(h.position),
    label,
    kind:
      h.kind === RESOLVE_KIND_TYPE
        ? (1 satisfies monacoNs.languages.InlayHintKind)
        : (2 satisfies monacoNs.languages.InlayHintKind),
    paddingLeft: h.paddingLeft,
    paddingRight: h.paddingRight,
    tooltip:
      typeof h.tooltip === "string"
        ? h.tooltip
        : h.tooltip
          ? { value: h.tooltip.value }
          : undefined,
    // Carry the LSP shape so resolveInlayHint can roundtrip via the server.
    __lspHint: h,
    __serverId: serverId,
  } as never;
}

function toLabelPart(p: LspInlayHintLabelPart): monacoNs.languages.InlayHintLabelPart {
  const part: monacoNs.languages.InlayHintLabelPart = { label: p.value };
  if (p.location) {
    (part as monacoNs.languages.InlayHintLabelPart).location = {
      uri: { toString: () => p.location!.uri } as never,
      range: lspRangeToMonaco(p.location.range),
    } as never;
  }
  if (p.tooltip) {
    part.tooltip =
      typeof p.tooltip === "string" ? p.tooltip : { value: p.tooltip.value };
  }
  if (p.command) {
    const cmd: monacoNs.languages.Command = {
      id: p.command.command,
      title: p.command.title,
    };
    if (p.command.arguments) cmd.arguments = p.command.arguments as unknown[];
    part.command = cmd;
  }
  return part;
}

function pathOf(model: monacoNs.editor.ITextModel): string {
  return (model.uri as { fsPath?: string }).fsPath ?? model.uri.path;
}
