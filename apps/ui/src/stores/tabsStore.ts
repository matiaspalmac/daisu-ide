import { create } from "zustand";
import { nanoid } from "nanoid";

export interface OpenTab {
  id: string;
  path: string | null;
  name: string;
  language: string;
  content: string;
  savedContent: string;
}

export interface AddTabInput {
  path: string | null;
  name: string;
  language: string;
  content: string;
}

interface TabsState {
  tabs: OpenTab[];
  activeTabId: string | null;

  addTab: (input: AddTabInput) => string;
  updateContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  closeTab: (id: string) => void;
  setActive: (id: string | null) => void;
  isDirty: (id: string) => boolean;
  activeTab: () => OpenTab | null;
  reset: () => void;
}

export const useTabs = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  addTab: (input) => {
    const existing = get().tabs.find((t) => t.path !== null && t.path === input.path);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = nanoid();
    const tab: OpenTab = {
      id,
      path: input.path,
      name: input.name,
      language: input.language,
      content: input.content,
      savedContent: input.content,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    return id;
  },
  updateContent: (id, content) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, content } : t)) })),
  markSaved: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, savedContent: t.content } : t)),
    })),
  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return s;
      const next = s.tabs.filter((t) => t.id !== id);
      let nextActive = s.activeTabId;
      if (s.activeTabId === id) {
        nextActive = next[Math.min(idx, next.length - 1)]?.id ?? null;
      }
      return { tabs: next, activeTabId: nextActive };
    }),
  setActive: (id) => set({ activeTabId: id }),
  isDirty: (id) => {
    const t = get().tabs.find((tab) => tab.id === id);
    return t ? t.content !== t.savedContent : false;
  },
  activeTab: () => {
    const id = get().activeTabId;
    return id ? get().tabs.find((t) => t.id === id) ?? null : null;
  },
  reset: () => set({ tabs: [], activeTabId: null }),
}));
