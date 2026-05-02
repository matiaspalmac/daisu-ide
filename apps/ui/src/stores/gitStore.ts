import { create } from "zustand";

export type GitFileStatus =
  | "Untracked"
  | "Modified"
  | "Staged"
  | "Conflict"
  | "Ignored"
  | "Renamed";

export interface GitWorkspaceInfo {
  branch: string;
  ahead: number;
  behind: number;
  remoteUrl: string | null;
  statuses: Record<string, GitFileStatus>;
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream: string | null;
}

interface GitState {
  workspaceInfo: GitWorkspaceInfo | null;
  statuses: Map<string, GitFileStatus>;
  branches: BranchInfo[];
  loading: boolean;
  fetching: boolean;
  lastFetchedAt: number | null;

  setWorkspaceInfo: (info: GitWorkspaceInfo) => void;
  setBranches: (branches: BranchInfo[]) => void;
  setLoading: (loading: boolean) => void;
  setFetching: (fetching: boolean) => void;
  markFetched: () => void;
  clear: () => void;
}

export const useGit = create<GitState>((set) => ({
  workspaceInfo: null,
  statuses: new Map(),
  branches: [],
  loading: false,
  fetching: false,
  lastFetchedAt: null,
  setWorkspaceInfo: (info) =>
    set({
      workspaceInfo: info,
      statuses: new Map(Object.entries(info.statuses)),
    }),
  setBranches: (branches) => set({ branches }),
  setLoading: (loading) => set({ loading }),
  setFetching: (fetching) => set({ fetching }),
  markFetched: () => set({ lastFetchedAt: Date.now() }),
  clear: () =>
    set({
      workspaceInfo: null,
      statuses: new Map(),
      branches: [],
      loading: false,
      fetching: false,
      lastFetchedAt: null,
    }),
}));
