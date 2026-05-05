import { create } from "zustand";

export interface TerminalTab {
  uiId: string;
  title: string;
}

interface TerminalState {
  open: boolean;
  tabs: TerminalTab[];
  activeId: string | null;
  toggle(): void;
  setOpen(open: boolean): void;
  newTab(): void;
  closeTab(uiId: string): void;
  setActive(uiId: string): void;
  rename(uiId: string, title: string): void;
}

let counter = 0;

export const useTerminal = create<TerminalState>((set) => ({
  open: false,
  tabs: [],
  activeId: null,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  newTab: () =>
    set((s) => {
      counter += 1;
      const tab: TerminalTab = { uiId: `t${counter}`, title: `Terminal ${counter}` };
      return {
        open: true,
        tabs: [...s.tabs, tab],
        activeId: tab.uiId,
      };
    }),
  closeTab: (uiId) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.uiId !== uiId);
      const last = tabs[tabs.length - 1];
      const activeId = tabs.length === 0
        ? null
        : s.activeId === uiId
          ? (last ? last.uiId : null)
          : s.activeId;
      return {
        tabs,
        activeId,
        open: tabs.length > 0 && s.open,
      };
    }),
  setActive: (uiId) => set({ activeId: uiId }),
  rename: (uiId, title) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.uiId === uiId ? { ...t, title } : t)) })),
}));
