import { useEffect, type JSX } from "react";
import { listen } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import { SearchInput } from "../search/SearchInput";
import { ReplaceInput } from "../search/ReplaceInput";
import { GlobFilters } from "../search/GlobFilters";
import { ResultsList } from "../search/ResultsList";
import { useSearch } from "../../stores/searchStore";
import { useUI } from "../../stores/uiStore";
import { useWorkspace } from "../../stores/workspaceStore";
import type {
  SearchHitEvent,
  SearchProgressEvent,
  SearchSummary,
} from "../../api/tauri";

export function SearchPanel(): JSX.Element {
  const open = useUI((s) => s.searchPanelOpen);
  const ingestHits = useSearch((s) => s.ingestHits);
  const ingestProgress = useSearch((s) => s.ingestProgress);
  const markDone = useSearch((s) => s.markDone);
  const setWorkspacePath = useSearch((s) => s.setWorkspacePath);
  const loadRecentQueries = useSearch((s) => s.loadRecentQueries);
  const toggleSearch = useUI((s) => s.toggleSearchPanel);
  const rootPath = useWorkspace((s) => s.rootPath);

  useEffect(() => {
    setWorkspacePath(rootPath ?? null);
  }, [rootPath, setWorkspacePath]);

  useEffect(() => {
    void loadRecentQueries();
  }, [loadRecentQueries]);

  useEffect(() => {
    let cancelled = false;
    let unlisteners: Array<() => void> = [];

    const subscribe = async <T,>(
      event: string,
      handler: (payload: T) => void,
    ): Promise<void> => {
      const fn = await listen<T>(event, (e) => handler(e.payload));
      if (cancelled) {
        fn();
        return;
      }
      unlisteners.push(fn);
    };

    // Only ingest events whose requestId matches the store's activeRequestId.
    // A late event from a previous (still-flushing) search would otherwise
    // mix stale hits into the new result set or prematurely clear
    // activeRequestId on a `done` / `cancelled` event from the old request.
    const sameRequest = (rid: unknown): boolean => {
      const active = useSearch.getState().activeRequestId;
      return typeof rid === "string" && rid === active;
    };

    void subscribe<SearchHitEvent>("search-hit", (e) => {
      const rid = (e as unknown as { request_id?: string }).request_id ?? e.requestId;
      if (!sameRequest(rid)) return;
      const raw = (e as unknown as { hits?: unknown }).hits ?? e.hits;
      const hits = (raw as Array<{
        id: string;
        path: string;
        line_no: number;
        line_text: string;
        match_start_col: number;
        match_end_col: number;
      }>).map((h) => ({
        id: h.id,
        path: h.path,
        lineNo: h.line_no,
        lineText: h.line_text,
        matchStartCol: h.match_start_col,
        matchEndCol: h.match_end_col,
      }));
      ingestHits(hits);
    });
    void subscribe<SearchProgressEvent>("search-progress", (e) => {
      const rid = (e as unknown as { request_id?: string }).request_id ?? e.requestId;
      if (!sameRequest(rid)) return;
      const filesSearched = (e as unknown as { files_searched?: number })
        .files_searched ?? e.filesSearched;
      ingestProgress(filesSearched);
    });
    void subscribe<SearchSummary>("search-done", (e) => {
      const rid = (e as unknown as { request_id?: string }).request_id ?? e.requestId;
      if (!sameRequest(rid)) return;
      const truncated = (e as unknown as { truncated?: boolean }).truncated ?? false;
      markDone(truncated);
    });
    void subscribe<string>("search-cancelled", (rid) => {
      if (!sameRequest(rid)) return;
      markDone(false);
    });

    return () => {
      cancelled = true;
      for (const u of unlisteners) u();
      unlisteners = [];
    };
  }, [ingestHits, ingestProgress, markDone]);

  if (!open) return <></>;

  return (
    <section className="daisu-search-panel" aria-label="Workspace search">
      <header className="daisu-search-header">
        <span>Search</span>
        <button
          type="button"
          className="daisu-icon-btn-sm"
          onClick={() => toggleSearch()}
          aria-label="Close search panel"
        >
          <X size={12} />
        </button>
      </header>
      <SearchInput />
      <ReplaceInput />
      <GlobFilters />
      <ResultsList />
    </section>
  );
}
