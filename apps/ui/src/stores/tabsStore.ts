import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type * as monaco from "monaco-editor";
import {
  deleteSessionCmd,
  loadSessionCmd,
  openFile,
  saveFile,
  saveFileAsViaDialog,
  saveSessionCmd,
} from "../api/tauri";
import { disposeAllModels, disposeModel } from "../lib/monaco-models";
import {
  EMPTY_SESSION,
  parseSessionBlob,
  type SessionBlob,
} from "../lib/session-schema";

export interface OpenTab {
  id: string;
  path: string | null;
  name: string;
  language: string;
  content: string;
  savedContent: string;
  cursorState: monaco.editor.ICodeEditorViewState | null;
  pinned: boolean;
  untitledIndex: number | null;
  eol: "LF" | "CRLF";
  encoding: string;
}

export interface ClosedTabSnapshot {
  id: string;
  path: string | null;
  name: string;
  language: string;
  content: string;
  savedContent: string;
  closedAt: number;
  eol: "LF" | "CRLF";
  encoding: string;
}

export type PendingCloseMode = "single" | "batch";

export interface PendingClose {
  ids: string[];
  mode: PendingCloseMode;
}

interface TabsState {
  tabs: OpenTab[];
  activeTabId: string | null;
  mruOrder: string[];
  recentlyClosed: ClosedTabSnapshot[];
  untitledCounter: number;
  pendingClose: PendingClose | null;
  workspaceHash: string | null;

  openTab(path: string): Promise<void>;
  newTab(): void;
  closeTab(id: string, force?: boolean): Promise<void>;
  closeActive(): Promise<void>;
  closeOthers(id: string, force?: boolean): Promise<void>;
  closeAll(force?: boolean): Promise<void>;
  reopenClosed(): Promise<void>;
  setActive(id: string): void;
  setActiveByIndex(index: number): void;
  cycleTabs(dir: 1 | -1): void;
  reorder(fromId: string, toIndex: number): void;
  pin(id: string): void;
  unpin(id: string): void;
  updateContent(id: string, content: string): void;
  setLanguage(id: string, languageId: string): void;
  saveActive(): Promise<void>;
  saveActiveAs(): Promise<void>;
  saveAll(): Promise<void>;

  saveSession(): Promise<void>;
  restoreSession(workspaceHash: string): Promise<void>;
  clearSession(workspaceHash: string): Promise<void>;

  resolvePendingClose(action: "save" | "discard" | "cancel"): Promise<void>;

  reset(): void;

  _setWorkspaceHash(hash: string | null): void;
  _setCursorState(id: string, state: monaco.editor.ICodeEditorViewState | null): void;
}

const RECENT_CAP = 20;
const SESSION_VERSION = 1 as const;

const RUNTIME_INITIAL = (): Pick<
  TabsState,
  | "tabs"
  | "activeTabId"
  | "mruOrder"
  | "recentlyClosed"
  | "untitledCounter"
  | "pendingClose"
  | "workspaceHash"
> => ({
  tabs: [],
  activeTabId: null,
  mruOrder: [],
  recentlyClosed: [],
  untitledCounter: 0,
  pendingClose: null,
  workspaceHash: null,
});

function basenameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function pinnedCount(tabs: OpenTab[]): number {
  let n = 0;
  for (const t of tabs) if (t.pinned) n += 1;
  return n;
}

function clampIntoSegment(tabs: OpenTab[], movingTabPinned: boolean, target: number): number {
  const pCount = pinnedCount(tabs);
  if (movingTabPinned) {
    return Math.max(0, Math.min(target, pCount - 1));
  }
  return Math.max(pCount, Math.min(target, tabs.length - 1));
}

function pruneMruOrder(mru: string[], existingIds: Set<string>): string[] {
  return mru.filter((id) => existingIds.has(id));
}

function snapshotForSession(state: TabsState): SessionBlob {
  return {
    version: SESSION_VERSION,
    savedAt: Date.now(),
    activeTabId: state.activeTabId,
    untitledCounter: state.untitledCounter,
    tabs: state.tabs.map((t) => ({
      id: t.id,
      path: t.path,
      name: t.name,
      language: t.language,
      content: t.content,
      savedContent: t.savedContent,
      cursorState: t.cursorState as unknown as SessionBlob["tabs"][number]["cursorState"],
      pinned: t.pinned,
      untitledIndex: t.untitledIndex,
      eol: t.eol,
      encoding: t.encoding,
    })),
    mruOrder: state.mruOrder,
    recentlyClosed: state.recentlyClosed,
  };
}

function applySession(blob: SessionBlob): Partial<TabsState> {
  const tabs: OpenTab[] = blob.tabs.map((t) => ({
    id: t.id,
    path: t.path,
    name: t.name,
    language: t.language,
    content: t.content,
    savedContent: t.savedContent,
    cursorState: t.cursorState as unknown as monaco.editor.ICodeEditorViewState | null,
    pinned: t.pinned,
    untitledIndex: t.untitledIndex,
    eol: (t as { eol?: "LF" | "CRLF" }).eol ?? "LF",
    encoding: (t as { encoding?: string }).encoding ?? "UTF-8",
  }));
  const ids = new Set(tabs.map((t) => t.id));
  return {
    tabs,
    activeTabId:
      blob.activeTabId && ids.has(blob.activeTabId)
        ? blob.activeTabId
        : tabs[0]?.id ?? null,
    mruOrder: pruneMruOrder(blob.mruOrder, ids),
    recentlyClosed: blob.recentlyClosed.slice(0, RECENT_CAP),
    untitledCounter: blob.untitledCounter,
  };
}

let saveInFlight = false;
let restoring = false;

export const useTabs = create<TabsState>((set, get) => ({
  ...RUNTIME_INITIAL(),

  async openTab(path) {
    const existing = get().tabs.find((t) => t.path === path);
    if (existing) {
      get().setActive(existing.id);
      return;
    }
    let opened: Awaited<ReturnType<typeof openFile>>;
    try {
      opened = await openFile(path);
    } catch (e) {
      // Surface backend errors (permission denied, file gone, binary blob,
      // etc.) so the click does not silently no-op.
      const { useUI } = await import("./uiStore");
      const { translateError } = await import("../lib/error-translate");
      useUI.getState().pushToast({
        message: translateError(e),
        level: "error",
      });
      return;
    }
    const tab: OpenTab = {
      id: uuid(),
      path: opened.path,
      name: basenameOf(opened.path),
      language: opened.language,
      content: opened.contents,
      savedContent: opened.contents,
      cursorState: null,
      pinned: false,
      untitledIndex: null,
      eol: opened.eol ?? "LF",
      encoding: opened.encoding ?? "UTF-8",
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      mruOrder: [tab.id, ...s.mruOrder.filter((m) => m !== tab.id)],
    }));
    void get().saveSession();
  },

  newTab() {
    const next = get().untitledCounter + 1;
    const tab: OpenTab = {
      id: uuid(),
      path: null,
      name: `Untitled-${next}`,
      language: "plaintext",
      content: "",
      savedContent: "",
      cursorState: null,
      pinned: false,
      untitledIndex: next,
      eol: "LF",
      encoding: "UTF-8",
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      untitledCounter: next,
      mruOrder: [tab.id, ...s.mruOrder.filter((m) => m !== tab.id)],
    }));
    void get().saveSession();
  },

  async closeTab(id, force = false) {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    const dirty = tab.content !== tab.savedContent;
    if (dirty && !force) {
      set({ pendingClose: { ids: [id], mode: "single" } });
      return;
    }
    const closed: ClosedTabSnapshot = {
      id: tab.id,
      path: tab.path,
      name: tab.name,
      language: tab.language,
      content: tab.content,
      savedContent: tab.savedContent,
      closedAt: Date.now(),
      eol: tab.eol,
      encoding: tab.encoding,
    };
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const mru = s.mruOrder.filter((m) => m !== id);
      const wasActive = s.activeTabId === id;
      const next: Partial<TabsState> = {
        tabs,
        mruOrder: mru,
        recentlyClosed: [closed, ...s.recentlyClosed].slice(0, RECENT_CAP),
      };
      if (wasActive) {
        next.activeTabId = mru[0] ?? tabs[0]?.id ?? null;
      }
      return next;
    });
    disposeModel(id);
    void get().saveSession();
  },

  async closeActive() {
    const id = get().activeTabId;
    if (id) await get().closeTab(id);
  },

  async closeOthers(id, force = false) {
    const others = get().tabs.filter((t) => t.id !== id);
    const dirty = others.filter((t) => t.content !== t.savedContent);
    if (dirty.length > 0 && !force) {
      set({ pendingClose: { ids: dirty.map((t) => t.id), mode: "batch" } });
      return;
    }
    for (const t of others) {
      await get().closeTab(t.id, true);
    }
  },

  async closeAll(force = false) {
    const dirty = get().tabs.filter((t) => t.content !== t.savedContent);
    if (dirty.length > 0 && !force) {
      set({ pendingClose: { ids: dirty.map((t) => t.id), mode: "batch" } });
      return;
    }
    for (const t of [...get().tabs]) {
      await get().closeTab(t.id, true);
    }
  },

  async reopenClosed() {
    const head = get().recentlyClosed[0];
    if (!head) return;
    const tab: OpenTab = {
      id: uuid(),
      path: head.path,
      name: head.name,
      language: head.language,
      content: head.content,
      savedContent: head.savedContent,
      cursorState: null,
      pinned: false,
      untitledIndex: null,
      eol: head.eol ?? "LF",
      encoding: head.encoding ?? "UTF-8",
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      mruOrder: [tab.id, ...s.mruOrder],
      recentlyClosed: s.recentlyClosed.slice(1),
    }));
    void get().saveSession();
  },

  setActive(id) {
    if (!get().tabs.some((t) => t.id === id)) return;
    set((s) => ({
      activeTabId: id,
      mruOrder: [id, ...s.mruOrder.filter((m) => m !== id)],
    }));
    void get().saveSession();
  },

  setActiveByIndex(index) {
    const t = get().tabs[index];
    if (t) get().setActive(t.id);
  },

  cycleTabs(dir) {
    const mru = get().mruOrder;
    if (mru.length < 2) return;
    const current = get().activeTabId;
    const idx = current ? mru.indexOf(current) : -1;
    const nextIdx = (idx + dir + mru.length) % mru.length;
    const nextId = mru[nextIdx];
    if (nextId) get().setActive(nextId);
  },

  reorder(fromId, toIndex) {
    set((s) => {
      const moving = s.tabs.find((t) => t.id === fromId);
      if (!moving) return s;
      const without = s.tabs.filter((t) => t.id !== fromId);
      const clamped = clampIntoSegment([...without, moving], moving.pinned, toIndex);
      const next = [...without];
      next.splice(clamped, 0, moving);
      return { tabs: next };
    });
    void get().saveSession();
  },

  pin(id) {
    set((s) => {
      const moving = s.tabs.find((t) => t.id === id);
      if (!moving || moving.pinned) return s;
      const without = s.tabs.filter((t) => t.id !== id);
      const insertAt = pinnedCount(without);
      const next = [...without];
      next.splice(insertAt, 0, { ...moving, pinned: true });
      return { tabs: next };
    });
    void get().saveSession();
  },

  unpin(id) {
    set((s) => {
      const moving = s.tabs.find((t) => t.id === id);
      if (!moving || !moving.pinned) return s;
      const without = s.tabs.filter((t) => t.id !== id);
      const insertAt = pinnedCount(without);
      const next = [...without];
      next.splice(insertAt, 0, { ...moving, pinned: false });
      return { tabs: next };
    });
    void get().saveSession();
  },

  updateContent(id, content) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, content } : t)),
    }));
  },

  setLanguage(id, languageId) {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, language: languageId } : t,
      ),
    }));
    void get().saveSession();
  },

  async saveActive() {
    const active = get().tabs.find((t) => t.id === get().activeTabId);
    if (!active) return;
    if (active.path === null) {
      await get().saveActiveAs();
      return;
    }
    await saveFile(active.path, active.content);
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === active.id ? { ...t, savedContent: active.content } : t,
      ),
    }));
    void get().saveSession();
  },

  async saveActiveAs() {
    const active = get().tabs.find((t) => t.id === get().activeTabId);
    if (!active) return;
    const path = await saveFileAsViaDialog(active.content);
    if (!path) return;
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === active.id
          ? {
              ...t,
              path,
              name: basenameOf(path),
              savedContent: active.content,
              untitledIndex: null,
            }
          : t,
      ),
    }));
    void get().saveSession();
  },

  async saveAll() {
    for (const t of get().tabs) {
      if (t.path === null) continue;
      if (t.content !== t.savedContent) {
        await saveFile(t.path, t.content);
        set((s) => ({
          tabs: s.tabs.map((x) =>
            x.id === t.id ? { ...x, savedContent: t.content } : x,
          ),
        }));
      }
    }
    void get().saveSession();
  },

  async saveSession() {
    const hash = get().workspaceHash;
    if (!hash) return;
    // restoring is true while restoreSession is mid-flight; skipping prevents
    // the periodic auto-save from clobbering the previous workspace's session
    // file with the current (still-mounted) tabs during a workspace switch.
    if (restoring) return;
    if (saveInFlight) return;
    saveInFlight = true;
    try {
      const blob = snapshotForSession(get());
      await saveSessionCmd(hash, blob);
    } catch {
      // best-effort
    } finally {
      saveInFlight = false;
    }
  },

  async restoreSession(workspaceHash) {
    restoring = true;
    try {
      set({ workspaceHash });
      const raw = await loadSessionCmd(workspaceHash).catch(() => null);
      const blob = parseSessionBlob(raw);
      disposeAllModels();
      set({ ...RUNTIME_INITIAL(), workspaceHash, ...applySession(blob) });
    } finally {
      restoring = false;
    }
  },

  async clearSession(workspaceHash) {
    await deleteSessionCmd(workspaceHash).catch(() => undefined);
  },

  async resolvePendingClose(action) {
    const pending = get().pendingClose;
    if (!pending) return;
    set({ pendingClose: null });
    if (action === "cancel") return;
    if (action === "save") {
      for (const id of pending.ids) {
        const tab = get().tabs.find((t) => t.id === id);
        if (!tab) continue;
        if (tab.path === null) {
          // Untitled buffer in batch close. Activate the specific tab so
          // saveActiveAs() prompts for THIS tab's path, not whatever was
          // active before the modal opened.
          get().setActive(id);
          await get().saveActiveAs();
        } else {
          await saveFile(tab.path, tab.content);
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === id ? { ...t, savedContent: tab.content } : t,
            ),
          }));
        }
      }
    }
    for (const id of pending.ids) {
      await get().closeTab(id, true);
    }
  },

  reset() {
    disposeAllModels();
    set({ ...RUNTIME_INITIAL() });
  },

  _setWorkspaceHash(hash) {
    set({ workspaceHash: hash });
  },
  _setCursorState(id, state) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, cursorState: state } : t)),
    }));
  },
}));

export { EMPTY_SESSION };
