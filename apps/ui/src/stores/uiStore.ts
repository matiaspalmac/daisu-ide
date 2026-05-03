import { create } from "zustand";
import { nanoid } from "nanoid";

export type ToastLevel = "info" | "success" | "warning" | "error";

export type ActivityIcon = "files" | "search" | "git" | "extensions" | "graph" | "info";

export type RightPanelMode = "chat" | "config" | "hidden";

export interface ToastAction {
  label: string;
  onAction: () => void | Promise<void>;
}

export interface Toast {
  id: string;
  message: string;
  level: ToastLevel;
  durationMs?: number;
  action?: ToastAction;
}

interface UIState {
  sidebarWidth: number;
  agentsPanelWidth: number;
  searchPanelHeight: number;
  sidebarCollapsed: boolean;
  agentsPanelCollapsed: boolean;
  searchPanelOpen: boolean;
  settingsModalOpen: boolean;
  settingsActiveCategory: string;
  activeActivityIcon: ActivityIcon;
  rightPanelMode: RightPanelMode;
  toasts: Toast[];
  focusMode: boolean;
  sidebarFilter: string;
  sidebarMode: "files" | "search";

  toggleSidebar: () => void;
  setActiveActivityIcon: (id: ActivityIcon) => void;
  setRightPanelMode: (mode: RightPanelMode) => void;
  toggleAgentsPanel: () => void;
  toggleSearchPanel: () => void;
  setSidebarWidth: (px: number) => void;
  setAgentsPanelWidth: (px: number) => void;
  setSearchPanelHeight: (px: number) => void;
  openSettings: (category?: string) => void;
  closeSettings: () => void;
  pushToast: (toast: Omit<Toast, "id">) => string;
  dismissToast: (id: string) => void;
  toggleFocusMode: () => void;
  setSidebarFilter: (q: string) => void;
  setSidebarMode: (mode: "files" | "search") => void;
  reset: () => void;
}

const SIDEBAR_MIN = 120;
const SIDEBAR_MAX = 600;
const AGENTS_MIN = 200;
const AGENTS_MAX = 800;
const SEARCH_MIN = 120;
const SEARCH_MAX = 600;

const INITIAL: Pick<UIState,
  | "sidebarWidth" | "agentsPanelWidth" | "searchPanelHeight"
  | "sidebarCollapsed" | "agentsPanelCollapsed" | "searchPanelOpen"
  | "settingsModalOpen" | "settingsActiveCategory" | "activeActivityIcon"
  | "rightPanelMode" | "toasts" | "focusMode" | "sidebarFilter" | "sidebarMode"> = {
  sidebarWidth: 240,
  agentsPanelWidth: 320,
  searchPanelHeight: 240,
  sidebarCollapsed: false,
  agentsPanelCollapsed: false,
  searchPanelOpen: false,
  settingsModalOpen: false,
  settingsActiveCategory: "general",
  activeActivityIcon: "files",
  rightPanelMode: "chat",
  toasts: [],
  focusMode: ((): boolean => {
    try { return localStorage.getItem("daisu.focusMode") === "true"; } catch { return false; }
  })(),
  sidebarFilter: ((): string => {
    try { return localStorage.getItem("daisu.sidebarFilter") ?? ""; } catch { return ""; }
  })(),
  sidebarMode: "files",
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const useUI = create<UIState>((set) => ({
  ...INITIAL,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setActiveActivityIcon: (id) => set({ activeActivityIcon: id }),
  setRightPanelMode: (mode) => set({ rightPanelMode: mode }),
  toggleAgentsPanel: () => set((s) => ({ agentsPanelCollapsed: !s.agentsPanelCollapsed })),
  toggleSearchPanel: () =>
    set((s) => {
      // Sidebar swap pattern: search lives inside the sidebar in a separate
      // mode rather than a bottom split. Toggling search ensures the sidebar
      // is open and switches it to search view; toggling again returns to
      // files view.
      const goingToSearch = s.sidebarMode !== "search";
      return {
        sidebarMode: goingToSearch ? "search" : "files",
        sidebarCollapsed: goingToSearch ? false : s.sidebarCollapsed,
        searchPanelOpen: goingToSearch,
      };
    }),
  setSidebarWidth: (px) => set({ sidebarWidth: clamp(px, SIDEBAR_MIN, SIDEBAR_MAX) }),
  setAgentsPanelWidth: (px) => set({ agentsPanelWidth: clamp(px, AGENTS_MIN, AGENTS_MAX) }),
  setSearchPanelHeight: (px) => set({ searchPanelHeight: clamp(px, SEARCH_MIN, SEARCH_MAX) }),
  openSettings: (category = "general") => set({ settingsModalOpen: true, settingsActiveCategory: category }),
  closeSettings: () => set({ settingsModalOpen: false }),
  pushToast: (toast) => {
    const id = nanoid();
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  toggleFocusMode: () =>
    set((s) => {
      const next = !s.focusMode;
      try { localStorage.setItem("daisu.focusMode", String(next)); } catch { /* ignore */ }
      return { focusMode: next };
    }),
  setSidebarFilter: (q) => {
    try { localStorage.setItem("daisu.sidebarFilter", q); } catch { /* ignore */ }
    set({ sidebarFilter: q });
  },
  setSidebarMode: (mode) => set({ sidebarMode: mode, searchPanelOpen: mode === "search" }),
  reset: () => set(INITIAL),
}));
