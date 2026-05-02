import { create } from "zustand";

export interface SearchHit {
  id: string;
  path: string;
  line: number;
  matchStartCol: number;
  matchEndCol: number;
  lineText: string;
}

export type SearchScope = "workspace" | "currentFile";
export type BoolOption = "caseSensitive" | "useRegex" | "wholeWord" | "multiline";

interface SearchState {
  open: boolean;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean;
  multiline: boolean;
  includeGlobs: string[];
  excludeGlobs: string[];
  searchScope: SearchScope;
  results: SearchHit[];
  truncated: boolean;
  searching: boolean;
  expandedFiles: Set<string>;
  excludedHits: Set<string>;
  history: string[];
  replaceMode: boolean;

  setQuery: (q: string) => void;
  setReplacement: (r: string) => void;
  toggleOption: (opt: BoolOption) => void;
  setIncludeGlobs: (globs: string[]) => void;
  setExcludeGlobs: (globs: string[]) => void;
  setScope: (scope: SearchScope) => void;
  pushHistory: (q: string) => void;
  reset: () => void;
}

const HISTORY_CAP = 10;

const INITIAL: Pick<SearchState,
  | "open" | "query" | "replacement"
  | "caseSensitive" | "useRegex" | "wholeWord" | "multiline"
  | "includeGlobs" | "excludeGlobs" | "searchScope"
  | "results" | "truncated" | "searching"
  | "expandedFiles" | "excludedHits" | "history" | "replaceMode"> = {
  open: false,
  query: "",
  replacement: "",
  caseSensitive: false,
  useRegex: false,
  wholeWord: false,
  multiline: false,
  includeGlobs: [],
  excludeGlobs: [],
  searchScope: "workspace",
  results: [],
  truncated: false,
  searching: false,
  expandedFiles: new Set(),
  excludedHits: new Set(),
  history: [],
  replaceMode: false,
};

export const useSearch = create<SearchState>((set) => ({
  ...INITIAL,
  setQuery: (q) => set({ query: q }),
  setReplacement: (r) => set({ replacement: r }),
  toggleOption: (opt) => set((s) => ({ [opt]: !s[opt] }) as Partial<SearchState>),
  setIncludeGlobs: (globs) => set({ includeGlobs: globs }),
  setExcludeGlobs: (globs) => set({ excludeGlobs: globs }),
  setScope: (scope) => set({ searchScope: scope }),
  pushHistory: (q) =>
    set((s) => {
      const filtered = s.history.filter((h) => h !== q);
      return { history: [q, ...filtered].slice(0, HISTORY_CAP) };
    }),
  reset: () => set({ ...INITIAL, expandedFiles: new Set(), excludedHits: new Set() }),
}));
