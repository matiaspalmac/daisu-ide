import { create } from "zustand";
import { listBundledThemesCmd, type ThemeDescriptor } from "../api/tauri";

interface ThemesState {
  bundled: ThemeDescriptor[];
  loaded: boolean;
  loadBundled(): Promise<void>;
  filterByKind(kind: ThemeDescriptor["kind"]): ThemeDescriptor[];
  reset(): void;
}

export const useThemes = create<ThemesState>((set, get) => ({
  bundled: [],
  loaded: false,
  async loadBundled() {
    if (get().loaded) return;
    const list = await listBundledThemesCmd();
    set({ bundled: list, loaded: true });
  },
  filterByKind(kind) {
    return get().bundled.filter((t) => t.kind === kind);
  },
  reset() {
    set({ bundled: [], loaded: false });
  },
}));
