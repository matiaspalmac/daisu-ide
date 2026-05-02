import { create } from "zustand";

export interface RecentEntry {
  path: string;
  openedAt: number;
}

interface WorkspaceState {
  rootPath: string | null;
  recentWorkspaces: RecentEntry[];

  setRootPath: (path: string) => void;
  close: () => void;
  reset: () => void;
}

const RECENTS_CAP = 10;

const INITIAL: Pick<WorkspaceState, "rootPath" | "recentWorkspaces"> = {
  rootPath: null,
  recentWorkspaces: [],
};

export const useWorkspace = create<WorkspaceState>((set) => ({
  ...INITIAL,
  setRootPath: (path) =>
    set((s) => {
      const filtered = s.recentWorkspaces.filter((r) => r.path !== path);
      const next: RecentEntry[] = [{ path, openedAt: Date.now() }, ...filtered].slice(0, RECENTS_CAP);
      return { rootPath: path, recentWorkspaces: next };
    }),
  close: () => set({ rootPath: null }),
  reset: () => set(INITIAL),
}));
