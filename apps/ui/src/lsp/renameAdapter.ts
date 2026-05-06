import type * as monacoNs from "monaco-editor";
import { lspPrepareRename, lspRename, listServerStatus, type ServerStatus } from "../lib/lsp";
import { lspRangeToMonaco } from "./positions";
import { applyWorkspaceEdit } from "./workspaceEditApplier";
import { flushPendingChange } from "./monacoBridge";

/**
 * Resolve the rename location for Monaco's built-in widget. When the
 * server advertises `prepareProvider`, query it first; null result =
 * "cannot rename here" → Monaco shows `rejectReason` in the widget.
 */
export async function provideRenameLocation(
  path: string,
  language: string,
  position: { line: number; character: number },
): Promise<
  | { range: monacoNs.IRange; text: string }
  | { rejectReason: string }
  | null
> {
  const target = await pickServerForRename(language);
  if (!target) {
    return { rejectReason: "No language server provides rename for this file" };
  }
  if (!target.mutation.prepareRename) {
    // Server doesn't support prepareRename — caller falls back to letting
    // Monaco supply a default placeholder.
    return null;
  }
  await flushPendingChange(path);
  const res = await lspPrepareRename(
    path,
    position.line,
    position.character,
    target.serverId,
  ).catch(() => null);
  if (!res) {
    return { rejectReason: "Cannot rename this symbol" };
  }
  // LSP shape A: bare Range
  if ("start" in res && "end" in res) {
    return { range: lspRangeToMonaco(res), text: "" };
  }
  // LSP shape B: { range, placeholder }
  if ("range" in res && "placeholder" in res) {
    return { range: lspRangeToMonaco(res.range), text: res.placeholder };
  }
  // LSP shape C: { defaultBehavior: true } — let Monaco pick the word at cursor
  return null;
}

/**
 * Run the actual rename request and apply its WorkspaceEdit. Returns the
 * Monaco-shaped edit summary the caller can render in a toast.
 */
export async function applyRename(
  monaco: typeof monacoNs,
  path: string,
  language: string,
  position: { line: number; character: number },
  newName: string,
): Promise<{ applied: number; skipped: number }> {
  const target = await pickServerForRename(language);
  if (!target) return { applied: 0, skipped: 0 };
  await flushPendingChange(path);
  const edit = await lspRename(
    path,
    position.line,
    position.character,
    newName,
    target.serverId,
  ).catch(() => null);
  if (!edit) return { applied: 0, skipped: 0 };
  const result = await applyWorkspaceEdit(monaco, edit);
  return { applied: result.applied, skipped: result.skipped.length };
}

async function pickServerForRename(language: string): Promise<ServerStatus | null> {
  const statuses = await listServerStatus().catch(() => [] as ServerStatus[]);
  return (
    statuses.find(
      (s) =>
        s.state === "ready" &&
        s.mutation.rename &&
        s.languages.includes(language),
    ) ?? null
  );
}
