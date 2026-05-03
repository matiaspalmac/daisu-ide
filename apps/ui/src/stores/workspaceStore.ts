import { create } from "zustand";
import {
  closeWorkspaceCmd,
  copyPathCmd,
  createDirCmd,
  createFileCmd,
  deleteToTrashCmd,
  listDirCmd,
  openWorkspaceCmd,
  renamePathCmd,
  restoreFromTrashCmd,
  type FileEntry,
  type TrashRef,
} from "../api/tauri";
import {
  loadWorkspacePersistence,
  saveWorkspacePersistence,
  type WorkspacePersistence,
} from "../lib/persistent-store";

export interface RecentEntry {
  path: string;
  name: string;
  openedAt: number;
}

export interface ClipboardState {
  mode: "cut" | "copy";
  paths: string[];
}

export interface TreeBatch {
  batchId: string;
  parentPath: string | null;
  nodes: FileEntry[];
  done: boolean;
}

interface WorkspaceState {
  rootPath: string | null;
  workspaceHash: string | null;
  tree: Map<string, FileEntry>;
  childrenIndex: Map<string, string[]>;
  expanded: Set<string>;
  selection: Set<string>;
  selectionAnchor: string | null;
  clipboard: ClipboardState | null;
  walkSessionId: string | null;
  walkDone: boolean;
  walkError: string | null;
  recents: RecentEntry[];
  expandedPersisted: Record<string, string[]>;

  hydrate(): Promise<void>;
  openWorkspace(path: string): Promise<void>;
  closeWorkspace(): Promise<void>;
  reset(): void;

  applyBatch(batch: TreeBatch): void;
  applyFsChange(paths: string[]): Promise<void>;

  toggleExpand(path: string): void;

  selectNode(path: string, mode: "single" | "ctrl" | "shift"): void;
  clearSelection(): void;

  cut(paths: string[]): void;
  copy(paths: string[]): void;
  pasteInto(target: string): Promise<void>;

  createFile(parent: string, name: string): Promise<void>;
  createDir(parent: string, name: string): Promise<void>;
  rename(from: string, toName: string): Promise<void>;
  deleteToTrash(paths: string[]): Promise<TrashRef[]>;
  restoreFromTrash(refs: TrashRef[]): Promise<void>;
  moveNodes(dragIds: string[], targetParent: string): Promise<void>;

  _setRoot(rootPath: string, hash: string): void;
  _setWalkSession(id: string): void;
  _injectNode(node: FileEntry): void;
  _setChildren(parent: string, children: string[]): void;
}

const RECENTS_CAP = 10;

const INITIAL_RUNTIME = (): Pick<
  WorkspaceState,
  | "rootPath"
  | "workspaceHash"
  | "tree"
  | "childrenIndex"
  | "expanded"
  | "selection"
  | "selectionAnchor"
  | "clipboard"
  | "walkSessionId"
  | "walkDone"
  | "walkError"
> => ({
  rootPath: null,
  workspaceHash: null,
  tree: new Map(),
  childrenIndex: new Map(),
  expanded: new Set(),
  selection: new Set(),
  selectionAnchor: null,
  clipboard: null,
  walkSessionId: null,
  walkDone: false,
  walkError: null,
});

const naturalSort = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const parentOf = (p: string): string => {
  const idx = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return idx > 0 ? p.slice(0, idx) : p;
};

const basenameOf = (p: string): string => {
  const idx = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return idx >= 0 ? p.slice(idx + 1) : p;
};

const cheapHash = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
};

function sortChildren(
  childrenIndex: Map<string, string[]>,
  tree: Map<string, FileEntry>,
  parent: string
): void {
  const list = childrenIndex.get(parent);
  if (!list) return;
  list.sort((a, b) => {
    const na = tree.get(a);
    const nb = tree.get(b);
    if (na && nb && na.kind !== nb.kind) {
      return na.kind === "dir" ? -1 : 1;
    }
    return naturalSort(basenameOf(a), basenameOf(b));
  });
}

function persistSnapshot(state: WorkspaceState): WorkspacePersistence {
  const expandedPersisted = { ...state.expandedPersisted };
  if (state.workspaceHash) {
    expandedPersisted[state.workspaceHash] = [...state.expanded];
  }
  return { recents: state.recents, expandedPersisted };
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  ...INITIAL_RUNTIME(),
  recents: [],
  expandedPersisted: {},

  async hydrate() {
    const blob = await loadWorkspacePersistence();
    set({ recents: blob.recents, expandedPersisted: blob.expandedPersisted });
  },

  async openWorkspace(path) {
    // Pre-populate runtime BEFORE invoking the backend so the walker's tree
    // batches (which can arrive synchronously from the awaited command on
    // fast disks) accumulate against this session rather than being wiped
    // by a post-await `set({...INITIAL_RUNTIME})` race.
    set({
      ...INITIAL_RUNTIME(),
      rootPath: path,
      tree: new Map([
        [
          path,
          {
            path,
            name: basenameOf(path),
            kind: "dir",
            size: null,
            mtimeMs: null,
          },
        ],
      ]),
      childrenIndex: new Map([[path, []]]),
    });

    const info = await openWorkspaceCmd(path);
    const hash = cheapHash(info.root_path);
    const recents = [
      { path: info.root_path, name: basenameOf(info.root_path), openedAt: Date.now() },
      ...get().recents.filter((r) => r.path !== info.root_path),
    ].slice(0, RECENTS_CAP);
    const expandedPersisted = get().expandedPersisted;
    const restored = expandedPersisted[hash] ?? [];

    // Surgical merge: keep walker-populated tree/childrenIndex/walkDone but
    // patch in canonical root path and the backend-issued walkSessionId so
    // applyBatch can validate subsequent batches.
    set((state) => {
      const tree = new Map(state.tree);
      const childrenIndex = new Map(state.childrenIndex);
      if (path !== info.root_path) {
        // Rare: backend canonicalised the path. Drop the stub key but DO NOT
        // overwrite the canonical entries the walker may have already populated
        // (the walker emits with `info.root_path` as the parent key).
        tree.delete(path);
        childrenIndex.delete(path);
      }
      if (!tree.has(info.root_path)) {
        tree.set(info.root_path, {
          path: info.root_path,
          name: basenameOf(info.root_path),
          kind: "dir",
          size: null,
          mtimeMs: null,
        });
      }
      if (!childrenIndex.has(info.root_path)) {
        childrenIndex.set(info.root_path, []);
      }
      return {
        rootPath: info.root_path,
        workspaceHash: hash,
        walkSessionId: info.batch_id,
        tree,
        childrenIndex,
        expanded: new Set(restored),
        recents,
      };
    });
    void saveWorkspacePersistence(persistSnapshot(get()));
  },

  async closeWorkspace() {
    void saveWorkspacePersistence(persistSnapshot(get()));
    await closeWorkspaceCmd().catch(() => undefined);
    set({
      ...INITIAL_RUNTIME(),
      recents: get().recents,
      expandedPersisted: get().expandedPersisted,
    });
  },

  reset() {
    set({ ...INITIAL_RUNTIME(), recents: [], expandedPersisted: {} });
  },

  applyBatch(batch) {
    const state = get();
    // walkSessionId check intentionally relaxed: backend cancels stale walkers
    // via CancellationToken, so any batch that reaches us is for the current
    // session. The previous strict check caused races when the
    // backend-issued batch_id was set after the first batches arrived.
    if (state.walkSessionId !== null && batch.batchId !== state.walkSessionId) {
      // Defensive: still drop if explicitly mismatched after session locked in.
      return;
    }
    const tree = new Map(state.tree);
    const childrenIndex = new Map(state.childrenIndex);
    for (const node of batch.nodes) {
      tree.set(node.path, node);
      const parent = parentOf(node.path);
      const list = childrenIndex.get(parent) ?? [];
      if (!list.includes(node.path)) {
        list.push(node.path);
        childrenIndex.set(parent, list);
      }
      if (node.kind === "dir" && !childrenIndex.has(node.path)) {
        childrenIndex.set(node.path, []);
      }
    }
    const touchedParents = new Set(batch.nodes.map((n) => parentOf(n.path)));
    for (const p of touchedParents) {
      sortChildren(childrenIndex, tree, p);
    }
    set({
      tree,
      childrenIndex,
      walkDone: batch.done || state.walkDone,
    });
  },

  async applyFsChange(paths) {
    const parents = new Set(paths.map((p) => parentOf(p)));
    for (const parent of parents) {
      try {
        const entries = await listDirCmd(parent);
        const tree = new Map(get().tree);
        const childrenIndex = new Map(get().childrenIndex);
        const oldChildren = childrenIndex.get(parent) ?? [];
        for (const child of oldChildren) {
          tree.delete(child);
        }
        const newChildren: string[] = [];
        for (const e of entries) {
          tree.set(e.path, e);
          newChildren.push(e.path);
          if (e.kind === "dir" && !childrenIndex.has(e.path)) {
            childrenIndex.set(e.path, []);
          }
        }
        childrenIndex.set(parent, newChildren);
        sortChildren(childrenIndex, tree, parent);
        set({ tree, childrenIndex });
      } catch {
        // Parent disappeared mid-flight — ignore; subsequent walker batches reconcile.
      }
    }
  },

  toggleExpand(path) {
    const expanded = new Set(get().expanded);
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    set({ expanded });
    void saveWorkspacePersistence(persistSnapshot(get()));
  },

  selectNode(path, mode) {
    const state = get();
    if (mode === "single") {
      set({ selection: new Set([path]), selectionAnchor: path });
      return;
    }
    if (mode === "ctrl") {
      const next = new Set(state.selection);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      set({ selection: next, selectionAnchor: path });
      return;
    }
    const anchor = state.selectionAnchor ?? path;
    const flatOrder = flattenVisible(state);
    const i = flatOrder.indexOf(anchor);
    const j = flatOrder.indexOf(path);
    if (i === -1 || j === -1) {
      set({ selection: new Set([path]), selectionAnchor: path });
      return;
    }
    const [lo, hi] = i <= j ? [i, j] : [j, i];
    set({ selection: new Set(flatOrder.slice(lo, hi + 1)), selectionAnchor: path });
  },

  clearSelection() {
    set({ selection: new Set(), selectionAnchor: null });
  },

  cut(paths) {
    set({ clipboard: { mode: "cut", paths: [...paths] } });
  },
  copy(paths) {
    set({ clipboard: { mode: "copy", paths: [...paths] } });
  },
  async pasteInto(target) {
    const cb = get().clipboard;
    if (!cb) return;
    if (cb.mode === "cut") {
      for (const p of cb.paths) {
        await renamePathCmd(p, basenameOf(p)).catch(() => undefined);
      }
      set({ clipboard: null });
    } else {
      for (const p of cb.paths) {
        await copyPathCmd(p, target).catch(() => undefined);
      }
    }
  },

  async createFile(parent, name) {
    const newPath = `${parent}\\${name}`;
    const tree = new Map(get().tree);
    const childrenIndex = new Map(get().childrenIndex);
    tree.set(newPath, { path: newPath, name, kind: "file", size: 0, mtimeMs: Date.now() });
    childrenIndex.set(parent, [...(childrenIndex.get(parent) ?? []), newPath]);
    sortChildren(childrenIndex, tree, parent);
    set({ tree, childrenIndex });
    try {
      await createFileCmd(parent, name);
    } catch (e) {
      tree.delete(newPath);
      childrenIndex.set(
        parent,
        (childrenIndex.get(parent) ?? []).filter((p) => p !== newPath)
      );
      set({ tree, childrenIndex });
      throw e;
    }
  },

  async createDir(parent, name) {
    const newPath = `${parent}\\${name}`;
    const tree = new Map(get().tree);
    const childrenIndex = new Map(get().childrenIndex);
    tree.set(newPath, { path: newPath, name, kind: "dir", size: null, mtimeMs: Date.now() });
    childrenIndex.set(parent, [...(childrenIndex.get(parent) ?? []), newPath]);
    childrenIndex.set(newPath, []);
    sortChildren(childrenIndex, tree, parent);
    set({ tree, childrenIndex });
    try {
      await createDirCmd(parent, name);
    } catch (e) {
      tree.delete(newPath);
      childrenIndex.delete(newPath);
      childrenIndex.set(
        parent,
        (childrenIndex.get(parent) ?? []).filter((p) => p !== newPath)
      );
      set({ tree, childrenIndex });
      throw e;
    }
  },

  async rename(from, toName) {
    const parent = parentOf(from);
    const newPath = `${parent}\\${toName}`;
    const tree = new Map(get().tree);
    const childrenIndex = new Map(get().childrenIndex);
    const old = tree.get(from);
    if (!old) {
      await renamePathCmd(from, toName);
      return;
    }
    tree.delete(from);
    tree.set(newPath, { ...old, path: newPath, name: toName });
    const list = (childrenIndex.get(parent) ?? []).map((p) => (p === from ? newPath : p));
    childrenIndex.set(parent, list);
    sortChildren(childrenIndex, tree, parent);
    set({ tree, childrenIndex });
    try {
      await renamePathCmd(from, toName);
    } catch (e) {
      tree.delete(newPath);
      tree.set(from, old);
      childrenIndex.set(
        parent,
        (childrenIndex.get(parent) ?? []).map((p) => (p === newPath ? from : p))
      );
      set({ tree, childrenIndex });
      throw e;
    }
  },

  async deleteToTrash(paths) {
    const tree = new Map(get().tree);
    const childrenIndex = new Map(get().childrenIndex);
    const removed: { path: string; entry: FileEntry; parent: string }[] = [];
    for (const p of paths) {
      const entry = tree.get(p);
      if (entry) {
        const parent = parentOf(p);
        tree.delete(p);
        childrenIndex.set(
          parent,
          (childrenIndex.get(parent) ?? []).filter((x) => x !== p)
        );
        removed.push({ path: p, entry, parent });
      }
    }
    set({ tree, childrenIndex });
    try {
      const refs = await deleteToTrashCmd(paths);
      return refs;
    } catch (e) {
      for (const r of removed) {
        tree.set(r.path, r.entry);
        childrenIndex.set(r.parent, [...(childrenIndex.get(r.parent) ?? []), r.path]);
      }
      set({ tree, childrenIndex });
      throw e;
    }
  },

  async restoreFromTrash(refs) {
    await restoreFromTrashCmd(refs);
  },

  async moveNodes(dragIds, targetParent) {
    const succeeded: { from: string; to: string }[] = [];
    try {
      for (const from of dragIds) {
        const name = basenameOf(from);
        const to = `${targetParent}\\${name}`;
        await renamePathCmd(from, name);
        succeeded.push({ from, to });
      }
    } catch (e) {
      for (let i = succeeded.length - 1; i >= 0; i--) {
        const s = succeeded[i];
        if (!s) continue;
        await renamePathCmd(s.to, basenameOf(s.from)).catch(() => undefined);
      }
      throw e;
    }
  },

  _setRoot(rootPath, hash) {
    set({ rootPath, workspaceHash: hash });
  },
  _setWalkSession(id) {
    set({ walkSessionId: id });
  },
  _injectNode(node) {
    const tree = new Map(get().tree);
    tree.set(node.path, node);
    set({ tree });
  },
  _setChildren(parent, children) {
    const childrenIndex = new Map(get().childrenIndex);
    childrenIndex.set(parent, [...children]);
    set({ childrenIndex });
  },
}));

function flattenVisible(state: WorkspaceState): string[] {
  if (!state.rootPath) return [];
  const out: string[] = [];
  const recurse = (path: string): void => {
    out.push(path);
    if (state.expanded.has(path)) {
      const children = state.childrenIndex.get(path) ?? [];
      for (const c of children) recurse(c);
    }
  };
  for (const c of state.childrenIndex.get(state.rootPath) ?? []) recurse(c);
  return out;
}
