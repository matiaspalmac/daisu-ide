import { create } from "zustand";

export interface TerminalTab {
  uiId: string;
  title: string;
  shellId?: string;
}

interface TerminalState {
  open: boolean;
  tabs: TerminalTab[];
  activeId: string | null;
  toggle(): void;
  setOpen(open: boolean): void;
  newTab(shellId?: string): void;
  closeTab(uiId: string): void;
  setActive(uiId: string): void;
  rename(uiId: string, title: string): void;
}

// Monotonic ui-id seed — never reused so React keys stay unique even
// after rapid open/close cycles. The user-visible title is derived
// from the position in `tabs` instead of this counter, so closing all
// tabs and reopening starts at "Terminal 1" again.
let uiIdSeq = 0;

function nextTitle(tabs: TerminalTab[]): string {
  // Find the lowest unused integer suffix among existing titles.
  const used = new Set<number>();
  for (const t of tabs) {
    const m = /^Terminal (\d+)$/.exec(t.title);
    if (m && m[1]) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `Terminal ${n}`;
}

export const useTerminal = create<TerminalState>((set) => ({
  open: false,
  tabs: [],
  activeId: null,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  newTab: (shellId) =>
    set((s) => {
      uiIdSeq += 1;
      const tab: TerminalTab = {
        uiId: `t${uiIdSeq}`,
        title: nextTitle(s.tabs),
        ...(shellId ? { shellId } : {}),
      };
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
