import { create } from "zustand";

export type BottomTab = "problems" | "output" | "debug" | "terminal" | "ports";

interface BottomPanelState {
  open: boolean;
  active: BottomTab;
  toggle(): void;
  setOpen(open: boolean): void;
  setActive(tab: BottomTab): void;
  /** Open the panel and focus a tab. Used by action handlers. */
  show(tab: BottomTab): void;
}

export const useBottomPanel = create<BottomPanelState>((set) => ({
  open: false,
  active: "terminal",
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  setActive: (tab) => set({ active: tab }),
  show: (tab) => set({ open: true, active: tab }),
}));
