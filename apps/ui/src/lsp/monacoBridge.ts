import type * as monaco from "monaco-editor";
import { listen } from "@tauri-apps/api/event";
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
import { makeDefinitionProvider } from "./definitionAdapter";
import { makeReferenceProvider } from "./referencesAdapter";
import { makeDocumentSymbolProvider } from "./documentSymbolAdapter";
import { debounce } from "./debounce";

// Per-(language, serverId) Monaco disposables. Re-sync replaces the entire
// set so duplicate provider firing is avoided when capabilities flip.
const registrations = new Map<string, monaco.IDisposable[]>();

// Per-document immediate-flush function. Adapters call `flushPendingChange`
// before LSP requests to defeat the 200 ms didChange debounce race.
const pendingFlush = new Map<string, () => Promise<void>>();

let detachDiagnostics: (() => void) | null = null;
let serverReadyDetach: (() => void) | null = null;

export async function attach(
  monacoNs: typeof import("monaco-editor"),
): Promise<void> {
  if (!detachDiagnostics) {
    detachDiagnostics = attachDiagnosticsListener(monacoNs);
  }
  await syncProviders(monacoNs);
  if (!serverReadyDetach) {
    serverReadyDetach = await listen("lsp://server-ready", () => {
      void syncProviders(monacoNs);
    });
  }
}

async function syncProviders(
  monacoNs: typeof import("monaco-editor"),
): Promise<void> {
  let statuses: ServerStatus[];
  try {
    statuses = await listServerStatus();
  } catch {
    return;
  }
  for (const status of statuses) {
    if (status.resolution.kind !== "found" || status.state !== "ready") continue;
    for (const language of status.languages) {
      const key = `${language}|${status.serverId}`;
      registrations.get(key)?.forEach((d) => d.dispose());
      const ds: monaco.IDisposable[] = [];
      // Existing M4.1 providers (always registered when server ready):
      ds.push(
        monacoNs.languages.registerCompletionItemProvider(
          language,
          makeCompletionProvider(monacoNs, status.serverId),
        ),
      );
      ds.push(
        monacoNs.languages.registerHoverProvider(
          language,
          makeHoverProvider(status.serverId),
        ),
      );
      ds.push(
        monacoNs.languages.registerSignatureHelpProvider(
          language,
          makeSignatureHelpProvider(status.serverId),
        ),
      );
      // New M4.2a providers (capability-gated):
      if (status.capabilities.definition) {
        ds.push(
          monacoNs.languages.registerDefinitionProvider(
            language,
            makeDefinitionProvider(monacoNs, status.serverId),
          ),
        );
      }
      if (status.capabilities.references) {
        ds.push(
          monacoNs.languages.registerReferenceProvider(
            language,
            makeReferenceProvider(monacoNs, status.serverId),
          ),
        );
      }
      if (status.capabilities.documentSymbol) {
        ds.push(
          monacoNs.languages.registerDocumentSymbolProvider(
            language,
            makeDocumentSymbolProvider(status.serverId),
          ),
        );
      }
      registrations.set(key, ds);
    }
  }
}

export async function trackModelOpen(
  model: monaco.editor.ITextModel,
): Promise<void> {
  const path = (model.uri as { fsPath?: string }).fsPath ?? model.uri.path;
  try {
    await documentOpen(path, model.getValue());
  } catch {
    // Backend unavailable (no workspace trusted, dev rebuild) — bridge is
    // best-effort. Subsequent change/close calls are similarly guarded so
    // transient IPC failures don't spam the console.
    return;
  }
  const debounced = debounce((text: string) => {
    void documentChange(path, text).catch(() => undefined);
  }, 200);
  const flushNow = () =>
    documentChange(path, model.getValue()).catch(() => undefined);
  pendingFlush.set(path, flushNow);
  model.onDidChangeContent(() => debounced(model.getValue()));
  model.onWillDispose(() => {
    pendingFlush.delete(path);
    void documentClose(path).catch(() => undefined);
  });
}

export async function flushPendingChange(uri: monaco.Uri): Promise<void> {
  const path = (uri as { fsPath?: string }).fsPath ?? uri.path;
  const fn = pendingFlush.get(path);
  if (fn) await fn();
}
