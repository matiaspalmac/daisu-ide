import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { load } from "@tauri-apps/plugin-store";
import {
  cancelSearchCmd,
  replaceInWorkspaceCmd,
  searchWorkspaceCmd,
  type ReplaceResults,
  type SearchHit,
  type SearchOptions,
} from "../api/tauri";
import { mergeExcludeGlobs } from "../lib/glob-defaults";

const RECENT_CAP = 20;
const STORE_FILE = "search-history.json";
const STORE_KEY = "recentQueries";

type BoolOption = "caseSensitive" | "regex" | "wholeWord" | "multiline";

interface SearchState {
  query: string;
  replacement: string;
  options: Omit<SearchOptions, "query">;
  workspacePath: string | null;
  activeRequestId: string | null;
  hits: SearchHit[];
  filesSearched: number;
  done: boolean;
  truncated: boolean;
  recentQueries: string[];
  excludedHitIds: Set<string>;
  open: boolean;
  replaceMode: boolean;
  expandedFiles: Set<string>;

  setOpen(open: boolean): void;
  setReplaceMode(on: boolean): void;
  setWorkspacePath(path: string | null): void;
  setQuery(q: string): void;
  setReplacement(r: string): void;
  toggleOption(field: BoolOption): void;
  setIncludeGlobs(globs: string[]): void;
  setExcludeGlobs(globs: string[]): void;
  toggleFileExpanded(path: string): void;

  search(): Promise<void>;
  cancel(): Promise<void>;
  replaceAll(replacement: string): Promise<ReplaceResults>;
  toggleHitExcluded(id: string): void;
  clearResults(): void;

  ingestHits(hits: SearchHit[]): void;
  ingestProgress(filesSearched: number): void;
  markDone(truncated: boolean): void;

  pushRecentQuery(q: string): void;
  loadRecentQueries(): Promise<void>;

  reset(): void;
}

const DEFAULT_OPTIONS: Omit<SearchOptions, "query"> = {
  caseSensitive: false,
  regex: false,
  wholeWord: false,
  multiline: false,
  includeGlobs: [],
  excludeGlobs: [],
  maxResults: 5000,
};

export const useSearch = create<SearchState>((set, get) => ({
  query: "",
  replacement: "",
  options: { ...DEFAULT_OPTIONS },
  workspacePath: null,
  activeRequestId: null,
  hits: [],
  filesSearched: 0,
  done: false,
  truncated: false,
  recentQueries: [],
  excludedHitIds: new Set<string>(),
  open: false,
  replaceMode: false,
  expandedFiles: new Set<string>(),

  setOpen(open) {
    set({ open });
  },
  setReplaceMode(on) {
    set({ replaceMode: on });
  },
  setWorkspacePath(path) {
    set({ workspacePath: path });
  },
  setQuery(q) {
    set({ query: q });
  },
  setReplacement(r) {
    set({ replacement: r });
  },
  toggleOption(field) {
    set((s) => ({
      options: {
        ...s.options,
        [field]: !s.options[field],
      } as Omit<SearchOptions, "query">,
    }));
  },
  setIncludeGlobs(globs) {
    set((s) => ({ options: { ...s.options, includeGlobs: globs } }));
  },
  setExcludeGlobs(globs) {
    set((s) => ({ options: { ...s.options, excludeGlobs: globs } }));
  },
  toggleFileExpanded(path) {
    set((s) => {
      const next = new Set(s.expandedFiles);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { expandedFiles: next };
    });
  },

  async search() {
    const state = get();
    if (!state.workspacePath) return;
    if (state.query.trim().length === 0) {
      if (state.activeRequestId) {
        await cancelSearchCmd(state.activeRequestId).catch(() => undefined);
      }
      set({
        activeRequestId: null,
        hits: [],
        filesSearched: 0,
        done: false,
        truncated: false,
        excludedHitIds: new Set<string>(),
      });
      return;
    }
    if (state.activeRequestId) {
      await cancelSearchCmd(state.activeRequestId).catch(() => undefined);
    }
    const requestId = uuid();
    const fullOptions: SearchOptions = {
      ...state.options,
      excludeGlobs: mergeExcludeGlobs(state.options.excludeGlobs),
      query: state.query,
    };
    set({
      activeRequestId: requestId,
      hits: [],
      filesSearched: 0,
      done: false,
      truncated: false,
      excludedHitIds: new Set<string>(),
    });
    state.pushRecentQuery(state.query);
    try {
      await searchWorkspaceCmd(state.workspacePath, fullOptions, requestId);
    } catch {
      // backend errors render via Toast in component layer
    } finally {
      if (get().activeRequestId === requestId) {
        set({ activeRequestId: null });
      }
    }
  },

  async cancel() {
    const id = get().activeRequestId;
    if (!id) return;
    await cancelSearchCmd(id).catch(() => undefined);
    set({ activeRequestId: null, done: true });
  },

  async replaceAll(replacement) {
    const state = get();
    return replaceInWorkspaceCmd({
      options: { ...state.options, query: state.query },
      replacement,
      hits: state.hits,
      excludedHitIds: Array.from(state.excludedHitIds),
    });
  },

  toggleHitExcluded(id) {
    set((s) => {
      const next = new Set(s.excludedHitIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { excludedHitIds: next };
    });
  },

  clearResults() {
    set({
      hits: [],
      filesSearched: 0,
      done: false,
      truncated: false,
      excludedHitIds: new Set<string>(),
    });
  },

  ingestHits(hits) {
    set((s) => ({ hits: [...s.hits, ...hits] }));
  },
  ingestProgress(filesSearched) {
    set({ filesSearched });
  },
  markDone(truncated) {
    set({ done: true, truncated, activeRequestId: null });
  },

  pushRecentQuery(q) {
    if (q.trim().length === 0) return;
    set((s) => {
      const without = s.recentQueries.filter((x) => x !== q);
      return { recentQueries: [q, ...without].slice(0, RECENT_CAP) };
    });
    void persistRecent(get().recentQueries);
  },

  async loadRecentQueries() {
    try {
      const handle = await load(STORE_FILE);
      const raw = (await handle.get(STORE_KEY)) as unknown;
      if (Array.isArray(raw)) {
        set({
          recentQueries: raw
            .filter((x): x is string => typeof x === "string")
            .slice(0, RECENT_CAP),
        });
      }
    } catch {
      // first run, no file
    }
  },

  reset() {
    set({
      query: "",
      replacement: "",
      options: { ...DEFAULT_OPTIONS },
      workspacePath: null,
      activeRequestId: null,
      hits: [],
      filesSearched: 0,
      done: false,
      truncated: false,
      recentQueries: [],
      excludedHitIds: new Set<string>(),
      open: false,
      replaceMode: false,
      expandedFiles: new Set<string>(),
    });
  },
}));

async function persistRecent(queries: string[]): Promise<void> {
  try {
    const handle = await load(STORE_FILE);
    await handle.set(STORE_KEY, queries);
    await handle.save();
  } catch {
    // best-effort
  }
}
