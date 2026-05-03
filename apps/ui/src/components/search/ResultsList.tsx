import { useMemo, useState, type JSX } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { useSearch } from "../../stores/searchStore";
import { ResultLine } from "./ResultLine";
import type { SearchHit } from "../../api/tauri";

export function ResultsList(): JSX.Element {
  const hits = useSearch((s) => s.hits);
  const filesSearched = useSearch((s) => s.filesSearched);
  const truncated = useSearch((s) => s.truncated);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      const arr = map.get(hit.path) ?? [];
      arr.push(hit);
      map.set(hit.path, arr);
    }
    return Array.from(map.entries());
  }, [hits]);

  if (hits.length === 0) {
    return (
      <div className="daisu-search-empty">
        {filesSearched > 0
          ? `No results in ${filesSearched} files`
          : "Type to search"}
      </div>
    );
  }

  const toggle = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="daisu-search-results">
      <div className="daisu-search-summary">
        {hits.length} result{hits.length === 1 ? "" : "s"} in {grouped.length}{" "}
        file{grouped.length === 1 ? "" : "s"}
        {truncated && (
          <span className="daisu-search-truncated"> (truncated)</span>
        )}
      </div>
      {grouped.map(([path, fileHits]) => {
        const fileName = path.split(/[\\/]/).pop() ?? path;
        const isCollapsed = collapsed.has(path);
        return (
          <div key={path} className="daisu-search-file-group">
            <button
              type="button"
              className="daisu-search-file-header"
              onClick={() => toggle(path)}
            >
              {isCollapsed ? (
                <CaretRight size={12} />
              ) : (
                <CaretDown size={12} />
              )}
              <span className="daisu-search-file-name">{fileName}</span>
              <span className="daisu-search-file-count">
                ({fileHits.length})
              </span>
            </button>
            {!isCollapsed && (
              <div className="daisu-search-file-hits">
                {fileHits.map((h) => (
                  <ResultLine key={h.id} hit={h} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
