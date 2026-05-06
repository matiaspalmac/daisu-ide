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
let workspaceOpenedDetach: (() => void) | null = null;
// Map model → real workspace file path. The Monaco URI is synthetic
// (`daisu://tab/<id>`) so the LSP cannot derive a usable file path from
// `model.uri.fsPath` directly — we must pass it explicitly from the
// caller (which knows the originating `OpenTab.path`).
const trackedModels = new Map<monaco.editor.ITextModel, string>();
// Reverse index keyed by canonical file path. Used by inbound flows
// (diagnostics → markers, file-uri-keyed responses → model lookup) that
// know the real path but not the synthetic Monaco URI. Path keys are
// normalised to forward slashes + lower-cased drive letter on Windows so
// `file:///C:/foo` and `c:\foo` resolve to the same model.
const pathToModel = new Map<string, monaco.editor.ITextModel>();

function normalisePath(p: string): string {
  let normalised = p.replace(/\\/g, "/");
  // Windows: lower-case the drive letter so `C:/foo` and `c:/foo` collide.
  if (/^[A-Za-z]:\//.test(normalised)) {
    normalised = normalised[0]!.toLowerCase() + normalised.slice(1);
  }
  return normalised;
}

/** Real workspace path for a Monaco model, or null when the model is
 *  untracked (e.g. an untitled scratch buffer that bypassed the LSP
 *  bridge). LSP request adapters call this instead of reading
 *  `model.uri.fsPath`, which on a `daisu://tab/<id>` URI returns the
 *  synthetic slug and breaks the backend `language_for` / `file_uri`
 *  resolution. */
export function pathOfModel(model: monaco.editor.ITextModel): string | null {
  return trackedModels.get(model) ?? null;
}

/** Resolve a Monaco model from a canonical file path. Used by the
 *  diagnostics listener to attach markers to the correct model when the
 *  LSP delivers `file:///` URIs that do not match the synthetic Monaco
 *  URI scheme. */
export function modelOfPath(
  monacoNs: typeof import("monaco-editor"),
  filePath: string,
): monaco.editor.ITextModel | null {
  const direct = pathToModel.get(normalisePath(filePath));
  if (direct && !direct.isDisposed()) return direct;
  // Fallback: scan all Monaco models for a matching `fsPath`. Picks up
  // models created via `file://` URIs (peek widgets in `ensureModel`)
  // that bypassed `trackModelOpen` and therefore are not in the map.
  for (const m of monacoNs.editor.getModels()) {
    const fsPath = (m.uri as { fsPath?: string }).fsPath;
    if (fsPath && normalisePath(fsPath) === normalisePath(filePath)) return m;
  }
  return null;
}

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
  // Workspace-opened listener is attached ONCE at App boot via
  // `startWorkspaceOpenedListener` below; we no longer attach it here so
  // that it is live before the trust dialog runs (otherwise the event
  // races against `attach()` and tabs restored from the previous session
  // never get retracked, manifesting as "have to close and reopen the
  // file for LSP to start").
}

/** Attach the workspace-opened listener at App boot. Idempotent.
 *  Splits this from `attach()` so the listener exists before any
 *  trust-chip / restore-tabs flow can fire the event — otherwise the
 *  fire-and-forget event is dropped with no buffering. */
export async function startWorkspaceOpenedListener(): Promise<void> {
  if (workspaceOpenedDetach) return;
  workspaceOpenedDetach = await listen("lsp://workspace-opened", () => {
    for (const [model, path] of trackedModels.entries()) {
      if (!model.isDisposed()) void retrackModel(model, path);
    }
  });
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
  // Internal helper used by the rename adapter. Falls back to the
  // synthetic URI only when the model is untracked (e.g. peek widget),
  // which is benign here since the rename adapter rejects unknown paths
  // server-side.
  return pathOfModel(model) ?? ((model.uri as { fsPath?: string }).fsPath ?? model.uri.path);
}

export async function trackModelOpen(
  model: monaco.editor.ITextModel,
  filePath: string | null,
): Promise<void> {
  // Untitled scratch tabs have no on-disk path — there is nothing for the
  // LSP to analyse, so skip the entire bridge. Returning early also
  // prevents `language_for("")` thrash on the backend.
  if (!filePath) return;
  trackedModels.set(model, filePath);
  pathToModel.set(normalisePath(filePath), model);
  try {
    await documentOpen(filePath, model.getValue());
  } catch {
    // Backend unavailable (no workspace trusted, dev rebuild) — bridge is
    // best-effort. We still wire debounce/flush below so the next
    // `lsp://workspace-opened` event can re-attempt didOpen via
    // `retrackModel`. Without that wiring a model that opened before
    // trust would never get LSP behaviour even after granting trust.
  }
  if (pendingFlush.has(filePath)) return;
  const debounced = debounce((text: string) => {
    void documentChange(filePath, text).catch(() => undefined);
  }, 200);
  const flushNow = () =>
    documentChange(filePath, model.getValue()).catch(() => undefined);
  pendingFlush.set(filePath, flushNow);
  model.onDidChangeContent(() => debounced(model.getValue()));
  model.onWillDispose(() => {
    trackedModels.delete(model);
    pathToModel.delete(normalisePath(filePath));
    pendingFlush.delete(filePath);
    void documentClose(filePath).catch(() => undefined);
  });
}

/** Re-issue `documentOpen` for an already-tracked model. Called when
 *  the workspace transitions from untrusted → trusted, since the model's
 *  first open attempt failed with `no workspace open`. */
async function retrackModel(
  model: monaco.editor.ITextModel,
  filePath: string,
): Promise<void> {
  await documentOpen(filePath, model.getValue()).catch(() => undefined);
}

/** Flush any pending debounced `didChange` for the given target. Accepts
 *  either an explicit file path string (when the caller already resolved
 *  it via `pathOfModel`) or a Monaco model (the bridge resolves the path
 *  via the trackedModels map — `model.uri` is synthetic and cannot be
 *  used directly as a key). */
export async function flushPendingChange(
  target: monaco.editor.ITextModel | string,
): Promise<void> {
  const path =
    typeof target === "string" ? target : (pathOfModel(target) ?? null);
  if (!path) return;
  const fn = pendingFlush.get(path);
  if (fn) await fn();
}
