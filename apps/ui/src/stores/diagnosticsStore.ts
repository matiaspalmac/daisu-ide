import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface UiPosition {
  line: number;
  character: number;
}

export interface UiRange {
  start: UiPosition;
  end: UiPosition;
}

export interface UiDiagnostic {
  range: UiRange;
  severity?: 1 | 2 | 3 | 4;
  code?: string | number;
  source?: string;
  message: string;
}

export interface UiDiagnosticEvent {
  uri: string;
  version: number | null;
  serverId: string;
  diagnostics: UiDiagnostic[];
}

interface DiagnosticsState {
  /** Map: `${uri}|${serverId}` → diagnostics. */
  byKey: Record<string, UiDiagnostic[]>;
  hydrated: boolean;
  apply(ev: UiDiagnosticEvent): void;
  clearForServer(serverId: string): void;
  totals(): { errors: number; warnings: number; infos: number; hints: number };
}

const DIAGNOSTICS_EVENT = "agent://lsp-diagnostics";

export const useDiagnostics = create<DiagnosticsState>((set, get) => ({
  byKey: {},
  hydrated: false,
  apply: (ev) =>
    set((s) => {
      const key = `${ev.uri}|${ev.serverId}`;
      const next = { ...s.byKey };
      if (ev.diagnostics.length === 0) delete next[key];
      else next[key] = ev.diagnostics;
      return { byKey: next };
    }),
  clearForServer: (serverId) =>
    set((s) => {
      const next: Record<string, UiDiagnostic[]> = {};
      for (const [k, v] of Object.entries(s.byKey)) {
        if (!k.endsWith(`|${serverId}`)) next[k] = v;
      }
      return { byKey: next };
    }),
  totals: () => {
    const totals = { errors: 0, warnings: 0, infos: 0, hints: 0 };
    for (const v of Object.values(get().byKey)) {
      for (const d of v) {
        switch (d.severity ?? 1) {
          case 1:
            totals.errors += 1;
            break;
          case 2:
            totals.warnings += 1;
            break;
          case 3:
            totals.infos += 1;
            break;
          case 4:
            totals.hints += 1;
            break;
        }
      }
    }
    return totals;
  },
}));

let unlistenPromise: Promise<UnlistenFn> | null = null;

export function startDiagnosticsListener(): void {
  if (unlistenPromise) return;
  unlistenPromise = listen<UiDiagnosticEvent>(DIAGNOSTICS_EVENT, (ev) => {
    useDiagnostics.getState().apply(ev.payload);
  });
  useDiagnostics.setState({ hydrated: true });
}
