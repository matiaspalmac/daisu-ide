import type * as monaco from "monaco-editor";
import {
  documentChange,
  documentClose,
  documentOpen,
  listServerStatus,
  type ServerStatus,
} from "../lib/lsp";
import { attachDiagnosticsListener } from "./diagnosticsListener";
import { makeCompletionProvider } from "./completionAdapter";
import { makeHoverProvider } from "./hoverAdapter";
import { makeSignatureHelpProvider } from "./signatureHelpAdapter";
import { debounce } from "./debounce";

const LANGUAGE_TO_SERVER: Record<string, string> = {
  rust: "rust-analyzer",
  typescript: "tsserver",
  typescriptreact: "tsserver",
  javascript: "tsserver",
  javascriptreact: "tsserver",
};

const registered = new Set<string>();
let detachDiagnostics: (() => void) | null = null;

export async function attach(
  editor: typeof import("monaco-editor"),
): Promise<void> {
  if (!detachDiagnostics) {
    detachDiagnostics = attachDiagnosticsListener(editor);
  }
  const statuses: ServerStatus[] = await listServerStatus();
  for (const status of statuses) {
    if (status.resolution.kind !== "found") continue;
    for (const language of status.languages) {
      const expected = LANGUAGE_TO_SERVER[language];
      if (expected !== status.serverId) continue;
      if (registered.has(language)) continue;
      registered.add(language);
      editor.languages.registerCompletionItemProvider(
        language,
        makeCompletionProvider(editor, status.serverId),
      );
      editor.languages.registerHoverProvider(
        language,
        makeHoverProvider(status.serverId),
      );
      editor.languages.registerSignatureHelpProvider(
        language,
        makeSignatureHelpProvider(status.serverId),
      );
    }
  }
}

export async function trackModelOpen(
  model: monaco.editor.ITextModel,
): Promise<void> {
  const path = (model.uri as { fsPath?: string }).fsPath ?? model.uri.path;
  await documentOpen(path, model.getValue());
  const debounced = debounce((text: string) => {
    void documentChange(path, text);
  }, 200);
  model.onDidChangeContent(() => debounced(model.getValue()));
  model.onWillDispose(() => {
    void documentClose(path);
  });
}
