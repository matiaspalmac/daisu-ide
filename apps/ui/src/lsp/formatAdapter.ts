import type * as monacoNs from "monaco-editor";
import {
  lspFormatting,
  lspRangeFormatting,
  listServerStatus,
  type ServerStatus,
  type LspTextEdit,
} from "../lib/lsp";
import type { LspRange } from "./types";
import { lspRangeToMonaco } from "./positions";
import { flushPendingChange } from "./monacoBridge";

/** Fetch document-level format edits and translate to Monaco operations. */
export async function provideDocumentFormattingEdits(
  path: string,
  language: string,
  options: monacoNs.languages.FormattingOptions,
): Promise<monacoNs.languages.TextEdit[]> {
  const target = await pickServerForFormatting(language, false);
  if (!target) return [];
  await flushPendingChange(path);
  const edits = await lspFormatting(
    path,
    options.tabSize,
    options.insertSpaces,
    target.serverId,
  ).catch(() => [] as LspTextEdit[]);
  return edits.map(toMonacoEdit);
}

/** Fetch range-level format edits. */
export async function provideRangeFormattingEdits(
  path: string,
  language: string,
  range: LspRange,
  options: monacoNs.languages.FormattingOptions,
): Promise<monacoNs.languages.TextEdit[]> {
  const target = await pickServerForFormatting(language, true);
  if (!target) return [];
  await flushPendingChange(path);
  const edits = await lspRangeFormatting(
    path,
    range,
    options.tabSize,
    options.insertSpaces,
    target.serverId,
  ).catch(() => [] as LspTextEdit[]);
  return edits.map(toMonacoEdit);
}

function toMonacoEdit(e: LspTextEdit): monacoNs.languages.TextEdit {
  return { range: lspRangeToMonaco(e.range), text: e.newText };
}

async function pickServerForFormatting(
  language: string,
  rangeMode: boolean,
): Promise<ServerStatus | null> {
  const statuses = await listServerStatus().catch(() => [] as ServerStatus[]);
  return (
    statuses.find(
      (s) =>
        s.state === "ready" &&
        s.languages.includes(language) &&
        (rangeMode ? s.mutation.rangeFormatting : s.mutation.documentFormatting),
    ) ?? null
  );
}
