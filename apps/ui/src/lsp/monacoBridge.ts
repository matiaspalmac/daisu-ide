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
import {
  provideRenameLocation,
  applyRename,
} from "./renameAdapter";
import {
  provideDocumentFormattingEdits,
  provideRangeFormattingEdits,
} from "./formatAdapter";
import { makeInlayHintsProvider } from "./inlayHintAdapter";
import {
  makeSemanticTokensProvider,
  type SemanticTokensLegend,
} from "./semanticTokensAdapter";
import { makeCodeActionProvider, runCodeAction } from "./codeActionAdapter";
import { lspExecuteCommand, type LspCodeAction } from "../lib/lsp";
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
      // M4.2c mutation providers (capability-gated):
      if (status.mutation.rename) {
        ds.push(
          monacoNs.languages.registerRenameProvider(language, {
            // Monaco types `resolveRenameLocation` as `RenameLocation & Rejection`
            // but the runtime contract is union-via-discriminator: either the
            // `rejectReason` field is present and rendered as the disabled
            // tooltip, or `range`+`text` populate the inline widget. Cast
            // through unknown to satisfy the over-strict structural type.
            resolveRenameLocation: async (model, position) => {
              const path = pathOf(model);
              const result = await provideRenameLocation(path, language, {
                line: position.lineNumber - 1,
                character: position.column - 1,
              });
              if (!result) {
                const word = model.getWordAtPosition(position);
                if (!word) {
                  return {
                    rejectReason: "Not a renameable symbol",
                  } as unknown as monaco.languages.RenameLocation & monaco.languages.Rejection;
                }
                return {
                  range: {
                    startLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endLineNumber: position.lineNumber,
                    endColumn: word.endColumn,
                  },
                  text: word.word,
                };
              }
              return result as unknown as monaco.languages.RenameLocation &
                monaco.languages.Rejection;
            },
            async provideRenameEdits(model, position, newName) {
              const path = pathOf(model);
              const summary = await applyRename(monacoNs, path, language, {
                line: position.lineNumber - 1,
                character: position.column - 1,
              }, newName);
              // Monaco's RenameProvider expects an edit object even if we
              // applied edits ourselves. Returning an empty `edits` array
              // signals "edits applied externally, do not re-apply".
              if (summary.applied === 0) return null;
              return { edits: [] };
            },
          }),
        );
      }
      if (status.mutation.documentFormatting) {
        ds.push(
          monacoNs.languages.registerDocumentFormattingEditProvider(language, {
            provideDocumentFormattingEdits: (model, options) =>
              provideDocumentFormattingEdits(pathOf(model), language, options),
          }),
        );
      }
      if (status.mutation.rangeFormatting) {
        ds.push(
          monacoNs.languages.registerDocumentRangeFormattingEditProvider(language, {
            provideDocumentRangeFormattingEdits: (model, range, options) =>
              provideRangeFormattingEdits(
                pathOf(model),
                language,
                {
                  start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
                  end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
                },
                options,
              ),
          }),
        );
      }
      // M4.3 advanced providers (capability-gated):
      if (status.advanced.inlayHint) {
        ds.push(
          monacoNs.languages.registerInlayHintsProvider(
            language,
            makeInlayHintsProvider({
              serverId: status.serverId,
              hasResolveProvider: status.advanced.inlayHintResolve,
            }),
          ),
        );
      }
      if (status.advanced.semanticTokensFull) {
        // Legend should come from `caps.semantic_tokens_provider.legend`
        // but ServerStatus does not currently carry it; ship a placeholder
        // and refresh from a future status field. rust-analyzer/tsserver
        // both supply rich legends — see M4.x followup.
        const legend: SemanticTokensLegend = {
          tokenTypes: [],
          tokenModifiers: [],
        };
        ds.push(
          monacoNs.languages.registerDocumentSemanticTokensProvider(
            language,
            makeSemanticTokensProvider({ serverId: status.serverId, legend }),
          ),
        );
      }
      if (status.advanced.codeAction) {
        ds.push(
          monacoNs.languages.registerCodeActionProvider(
            language,
            makeCodeActionProvider(monacoNs, {
              serverId: status.serverId,
              hasResolveProvider: status.advanced.codeActionResolve,
            }),
          ),
        );
      }
      registrations.set(key, ds);
    }
  }
  // Register the runCodeAction + executeCommand bridge commands once.
  if (!commandsRegistered) {
    monacoNs.editor.registerCommand(
      "daisu.lsp.runCodeAction",
      (_accessor, serverId: string, hasResolve: boolean, action: LspCodeAction) =>
        void runCodeAction(monacoNs, serverId, hasResolve, action),
    );
    monacoNs.editor.registerCommand(
      "daisu.lsp.executeCommand",
      (_accessor, serverId: string, command: string, args: unknown[]) =>
        void lspExecuteCommand(serverId, command, args).catch(() => undefined),
    );
    commandsRegistered = true;
  }
}

let commandsRegistered = false;

function pathOf(model: monaco.editor.ITextModel): string {
  return (model.uri as { fsPath?: string }).fsPath ?? model.uri.path;
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

export async function flushPendingChange(uri: monaco.Uri | string): Promise<void> {
  const path =
    typeof uri === "string"
      ? uri
      : ((uri as { fsPath?: string }).fsPath ?? uri.path);
  const fn = pendingFlush.get(path);
  if (fn) await fn();
}
