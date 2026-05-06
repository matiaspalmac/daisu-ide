import type * as monacoNs from "monaco-editor";
import {
  lspCodeAction,
  lspCodeActionResolve,
  lspExecuteCommand,
  type LspCodeAction,
  type LspCodeActionOrCommand,
  type LspCommand,
  type LspDiagnostic,
} from "../lib/lsp";
import { applyWorkspaceEdit } from "./workspaceEditApplier";
import { lspRangeToMonaco } from "./positions";
import { flushPendingChange } from "./monacoBridge";

export interface CodeActionAdapterOpts {
  serverId: string;
  hasResolveProvider: boolean;
}

interface MonacoNs {
  Uri: { parse(uri: string): monacoNs.Uri };
  editor: { getModel(uri: monacoNs.Uri): monacoNs.editor.ITextModel | null };
}

/** Build a Monaco-compatible CodeActionProvider for a given server. */
export function makeCodeActionProvider(
  monaco: typeof monacoNs,
  opts: CodeActionAdapterOpts,
): monacoNs.languages.CodeActionProvider {
  return {
    async provideCodeActions(model, range, context) {
      const path = pathOf(model);
      await flushPendingChange(path);
      const items = await lspCodeAction(
        path,
        {
          start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
          end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
        },
        // Diagnostics in scope are passed by Monaco — convert back to LSP shape.
        toLspDiagnostics(context.markers),
        opts.serverId,
      ).catch(() => [] as LspCodeActionOrCommand[]);
      return {
        actions: items.map((it) => toMonacoAction(monaco, it, opts)),
        dispose: () => undefined,
      };
    },
  };
}

function toMonacoAction(
  monaco: typeof monacoNs,
  item: LspCodeActionOrCommand,
  opts: CodeActionAdapterOpts,
): monacoNs.languages.CodeAction {
  if (isCommand(item)) {
    return {
      title: item.title,
      command: {
        id: "daisu.lsp.executeCommand",
        title: item.title,
        arguments: [opts.serverId, item.command, item.arguments ?? []],
      },
    };
  }
  // CodeAction. We register a wrapping command so Monaco picks it up,
  // routes through resolve+apply when invoked.
  const action: monacoNs.languages.CodeAction = {
    title: item.title,
    command: {
      id: "daisu.lsp.runCodeAction",
      title: item.title,
      arguments: [opts.serverId, opts.hasResolveProvider, item],
    },
  };
  if (item.kind) action.kind = item.kind;
  if (item.isPreferred !== undefined) action.isPreferred = item.isPreferred;
  if (item.disabled) action.disabled = item.disabled.reason;
  return action;
}

function isCommand(x: LspCodeActionOrCommand): x is LspCommand {
  return typeof (x as LspCommand).command === "string" && !("title" in x && "kind" in x);
}

function toLspDiagnostics(markers: monacoNs.editor.IMarkerData[]): LspDiagnostic[] {
  return markers.map((m) => {
    const d: LspDiagnostic = {
      range: {
        start: { line: m.startLineNumber - 1, character: m.startColumn - 1 },
        end: { line: m.endLineNumber - 1, character: m.endColumn - 1 },
      },
      severity: severityToLsp(m.severity),
      message: m.message,
    };
    const code = typeof m.code === "string" ? m.code : m.code?.value;
    if (code !== undefined) d.code = code;
    if (m.source) d.source = m.source;
    return d;
  });
}

function severityToLsp(s: monacoNs.MarkerSeverity): 1 | 2 | 3 | 4 {
  // Monaco: 8=Error, 4=Warning, 2=Info, 1=Hint → LSP 1/2/3/4
  if (s === 8) return 1;
  if (s === 4) return 2;
  if (s === 2) return 3;
  return 4;
}

/**
 * Run a code action — resolve if needed, apply edit if present, else
 * fall back to executing the action's command. Wired via Monaco command
 * registration in monacoBridge.
 */
export async function runCodeAction(
  monaco: typeof monacoNs,
  serverId: string,
  hasResolveProvider: boolean,
  action: LspCodeAction,
): Promise<void> {
  let resolved = action;
  if (!action.edit && !action.command && hasResolveProvider) {
    const fetched = await lspCodeActionResolve(serverId, action).catch(() => null);
    if (fetched) resolved = fetched;
  }
  if (resolved.edit) {
    await applyWorkspaceEdit(monaco, resolved.edit);
  } else if (resolved.command) {
    await lspExecuteCommand(
      serverId,
      resolved.command.command,
      (resolved.command.arguments as unknown[]) ?? [],
    ).catch(() => undefined);
  }
}

function pathOf(model: monacoNs.editor.ITextModel): string {
  return (model.uri as { fsPath?: string }).fsPath ?? model.uri.path;
}
