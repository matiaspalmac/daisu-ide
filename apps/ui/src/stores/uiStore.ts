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
  | "rightPanelMode" | "toasts"> = {
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
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const useUI = create<UIState>((set) => ({
  ...INITIAL,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setActiveActivityIcon: (id) => set({ activeActivityIcon: id }),
  setRightPanelMode: (mode) => set({ rightPanelMode: mode }),
  toggleAgentsPanel: () => set((s) => ({ agentsPanelCollapsed: !s.agentsPanelCollapsed })),
  toggleSearchPanel: () => set((s) => ({ searchPanelOpen: !s.searchPanelOpen })),
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
  reset: () => set(INITIAL),
}));
