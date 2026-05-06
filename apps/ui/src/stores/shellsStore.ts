import { create } from "zustand";
import {
  listShells,
  rescanShells,
  type DetectedShell,
} from "../lib/terminal";

interface ShellsState {
  shells: DetectedShell[];
  loaded: boolean;
  /** Load the cached detection result if not already loaded. */
  ensureLoaded: () => Promise<void>;
  /** Bypass the backend cache and re-scan from scratch. */
  rescan: () => Promise<void>;
  /** The shell flagged `isDefault` by detection (host login shell). */
  defaultShell: () => DetectedShell | null;
  /** Resolve a shell by id. */
  byId: (id: string) => DetectedShell | null;
}

export const useShells = create<ShellsState>((set, get) => ({
  shells: [],
  loaded: false,
  ensureLoaded: async () => {
    if (get().loaded) return;
    const shells = await listShells().catch(() => [] as DetectedShell[]);
    set({ shells, loaded: true });
  },
  rescan: async () => {
    const shells = await rescanShells().catch(() => [] as DetectedShell[]);
    set({ shells, loaded: true });
  },
  defaultShell: () => get().shells.find((s) => s.isDefault) ?? null,
  byId: (id: string) => get().shells.find((s) => s.id === id) ?? null,
}));
