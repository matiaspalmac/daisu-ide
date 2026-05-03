import { create } from "zustand";
import {
  gitCheckoutBranchCmd,
  gitFetchRemoteCmd,
  gitListBranchesCmd,
  gitWorkspaceInfoCmd,
  type BranchInfo,
  type FetchResult,
  type GitFileStatus,
  type GitWorkspaceInfo,
} from "../api/tauri";

interface GitState {
  workspacePath: string | null;
  info: GitWorkspaceInfo | null;
  branches: BranchInfo[];
  loading: boolean;

  setWorkspacePath(path: string | null): void;
  refresh(): Promise<void>;
  loadBranches(): Promise<void>;
  checkoutBranch(name: string, force: boolean): Promise<void>;
  fetchRemote(remote: string): Promise<FetchResult>;
  status(path: string): GitFileStatus | null;
  hasDirtyTree(): boolean;
  reset(): void;
}

export const useGit = create<GitState>((set, get) => ({
  workspacePath: null,
  info: null,
  branches: [],
  loading: false,

  setWorkspacePath(path) {
    set({ workspacePath: path });
    if (!path) set({ info: null, branches: [] });
  },

  async refresh() {
    const path = get().workspacePath;
    if (!path) return;
    set({ loading: true });
    try {
      const info = await gitWorkspaceInfoCmd(path);
      set({ info });
    } catch {
      set({ info: null });
    } finally {
      set({ loading: false });
    }
  },

  async loadBranches() {
    const path = get().workspacePath;
    if (!path) return;
    try {
      const branches = await gitListBranchesCmd(path);
      set({ branches });
    } catch {
      set({ branches: [] });
    }
  },

  async checkoutBranch(name, force) {
    const path = get().workspacePath;
    if (!path) return;
    await gitCheckoutBranchCmd(path, name, force);
    await get().refresh();
    await get().loadBranches();
  },

  async fetchRemote(remote) {
    const path = get().workspacePath;
    if (!path) {
      return { commitsReceived: 0, remote };
    }
    const result = await gitFetchRemoteCmd(path, remote);
    await get().refresh();
    return result;
  },

  status(path) {
    const info = get().info;
    if (!info) return null;
    return info.statuses[path] ?? null;
  },

  hasDirtyTree() {
    // Untracked files don't conflict with `safe()` checkout. Mirror the
    // backend's safe-checkout policy so the BranchPicker only triggers the
    // force-checkout dialog when the working tree actually has tracked
    // modifications/staged changes/conflicts.
    const info = get().info;
    if (!info) return false;
    return Object.values(info.statuses).some((s) => s !== "Untracked");
  },

  reset() {
    set({ workspacePath: null, info: null, branches: [], loading: false });
  },
}));
