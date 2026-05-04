import { create } from "zustand";

export type PaletteMode = "files" | "commands";

interface PaletteState {
  open: boolean;
  mode: PaletteMode;
  query: string;
  selectedIdx: number;

  openPalette: (mode: PaletteMode) => void;
  closePalette: () => void;
  togglePalette: (mode: PaletteMode) => void;
  setQuery: (q: string) => void;
  setSelectedIdx: (i: number) => void;
}

const INITIAL: Pick<PaletteState, "open" | "mode" | "query" | "selectedIdx"> = {
  open: false,
  mode: "files",
  query: "",
  selectedIdx: 0,
};

export const usePalette = create<PaletteState>((set) => ({
  ...INITIAL,
  openPalette: (mode) => set({ open: true, mode, query: "", selectedIdx: 0 }),
  closePalette: () => set({ open: false, query: "", selectedIdx: 0 }),
  togglePalette: (mode) =>
    set((s) =>
      s.open && s.mode === mode
        ? { ...INITIAL, open: false }
        : { open: true, mode, query: "", selectedIdx: 0 },
    ),
  setQuery: (q) => set({ query: q, selectedIdx: 0 }),
  setSelectedIdx: (i) => set({ selectedIdx: i }),
}));
