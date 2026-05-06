import type * as monaco from "monaco-editor";
import { listen } from "@tauri-apps/api/event";
import type { LspDiagnostic, LspDiagnosticEvent } from "../lib/lsp";

const DIAGNOSTICS_EVENT = "agent://lsp-diagnostics";

const SEVERITY_MAP: Record<1 | 2 | 3 | 4, number> = {
  1: 8 /* Error */,
  2: 4 /* Warning */,
  3: 2 /* Info */,
  4: 1 /* Hint */,
};

function lspToMarker(d: LspDiagnostic, namespace: string): monaco.editor.IMarkerData {
  const m: monaco.editor.IMarkerData = {
    severity: SEVERITY_MAP[d.severity ?? 1] as monaco.MarkerSeverity,
    message: d.message,
    source: namespace + (d.source ? `:${d.source}` : ""),
    startLineNumber: d.range.start.line + 1,
    startColumn: d.range.start.character + 1,
    endLineNumber: d.range.end.line + 1,
    endColumn: d.range.end.character + 1,
  };
  if (d.code !== undefined) m.code = String(d.code);
  return m;
}

export function attachDiagnosticsListener(
  editor: typeof import("monaco-editor"),
): () => void {
  let cancel: (() => void) | null = null;
  void listen<LspDiagnosticEvent>(DIAGNOSTICS_EVENT, (ev) => {
    const { uri, serverId, diagnostics } = ev.payload;
    const monacoUri = editor.Uri.parse(uri);
    const model = editor.editor.getModel(monacoUri);
    if (!model) return;
    const markers = diagnostics.map((d) => lspToMarker(d, serverId));
    editor.editor.setModelMarkers(model, `lsp:${serverId}`, markers);
  }).then((un) => {
    cancel = un;
  });
  return () => {
    if (cancel) cancel();
  };
}
