import type * as monacoNs from "monaco-editor";
import type { LspWorkspaceEdit, LspTextEdit } from "../lib/lsp";
import { lspRangeToMonaco } from "./positions";
import { ensureModel } from "./ensureModel";

export interface ApplyResult {
  /** Number of files we successfully edited. */
  applied: number;
  /** Files we skipped because the model was stale or could not load. */
  skipped: { uri: string; reason: "version-mismatch" | "load-failed" | "resource-op" }[];
}

/**
 * Apply an LSP `WorkspaceEdit` across N files in one logical undo group
 * per file. We sort edits **descending** by start position so that earlier
 * range coordinates remain valid as later edits modify the buffer; this is
 * the canonical applier rule shared by rust-analyzer and tsserver.
 *
 * We accept either the legacy `changes: { [uri]: TextEdit[] }` shape or
 * the modern `documentChanges: TextDocumentEdit[]` shape (LSP 3.16+).
 * Mixed `documentChanges` with resource operations (CreateFile / RenameFile
 * / DeleteFile) skip those entries with a `resource-op` reason — we don't
 * apply file-system moves in M4.2c.
 */
export async function applyWorkspaceEdit(
  monaco: typeof monacoNs,
  edit: LspWorkspaceEdit,
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: [] };

  if (edit.documentChanges && edit.documentChanges.length > 0) {
    for (const change of edit.documentChanges) {
      // Resource ops have no `edits` field — skip with reason. Plain
      // TextDocumentEdit always has `edits`.
      if (!("edits" in change)) {
        result.skipped.push({ uri: "", reason: "resource-op" });
        continue;
      }
      const uri = change.textDocument.uri;
      const expected = change.textDocument.version;
      const ok = await applyOneFile(monaco, uri, change.edits, expected, result);
      if (ok) result.applied += 1;
    }
    return result;
  }

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const ok = await applyOneFile(monaco, uri, edits, null, result);
      if (ok) result.applied += 1;
    }
  }
  return result;
}

async function applyOneFile(
  monaco: typeof monacoNs,
  uri: string,
  edits: LspTextEdit[],
  expectedVersion: number | null,
  result: ApplyResult,
): Promise<boolean> {
  const path = uriToPath(uri);
  if (!path) {
    result.skipped.push({ uri, reason: "load-failed" });
    return false;
  }
  const monacoUri = monaco.Uri.parse(uri);
  await ensureModel(monaco, monacoUri).catch(() => undefined);
  const model = monaco.editor.getModel(monacoUri);
  if (!model) {
    result.skipped.push({ uri, reason: "load-failed" });
    return false;
  }
  // LSP `OptionalVersionedTextDocumentIdentifier.version` is null when the
  // server doesn't track versions; only enforce the check when the server
  // provided a number. Monaco model versions and LSP doc versions are
  // distinct counters — the comparison is best-effort: if the server saw
  // version 4 and we now have a higher Monaco version, the user has typed
  // since the rename was prepared and the edit is stale.
  if (expectedVersion !== null) {
    const current = model.getVersionId();
    if (current > expectedVersion + 1) {
      result.skipped.push({ uri, reason: "version-mismatch" });
      return false;
    }
  }
  const ops = edits
    .map((e) => ({
      range: lspRangeToMonaco(e.range),
      text: e.newText,
      forceMoveMarkers: false,
    }))
    .sort((a, b) => {
      if (a.range.startLineNumber !== b.range.startLineNumber) {
        return b.range.startLineNumber - a.range.startLineNumber;
      }
      return b.range.startColumn - a.range.startColumn;
    });
  if (ops.length === 0) return false;
  model.pushEditOperations(null, ops, () => null);
  return true;
}

function uriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  // file:///C:/foo/bar.rs → C:/foo/bar.rs (Windows) or /home/x/y.rs (Unix)
  let decoded = decodeURIComponent(uri.slice(7));
  if (/^\/[A-Za-z]:/.test(decoded)) decoded = decoded.slice(1);
  return decoded;
}
