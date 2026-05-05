import type * as monaco from "monaco-editor";
import { openFile } from "../api/tauri";

/**
 * Ensure a Monaco text model exists for `uri` so the editor's peek/jump
 * widgets can render content for files the user has not opened in a tab.
 *
 * Models created here do NOT trigger LSP `didOpen` (that only happens via
 * `trackModelOpen` from `tabsStore.openTab`), so server overhead is zero.
 */
export async function ensureModel(
  monacoNs: typeof import("monaco-editor"),
  uri: monaco.Uri,
): Promise<void> {
  if (monacoNs.editor.getModel(uri)) return;
  const path = (uri as { fsPath?: string }).fsPath ?? uri.path;
  try {
    const opened = await openFile(path);
    monacoNs.editor.createModel(opened.contents, opened.language ?? undefined, uri);
  } catch {
    // peek widget shows empty placeholder — acceptable
  }
}
