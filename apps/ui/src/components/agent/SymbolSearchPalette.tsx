// Symbol search palette — M3 Phase 4 scaffold.
//
// Trigger: Ctrl+T (separate keybind from Ctrl+P / Ctrl+Shift+P). Renders
// against `agent_index_search` over the workspace SQLite FTS5 store. Empty
// queries show nothing — the palette is fundamentally a search UI, not a
// directory listing like the file palette.
//
// Keybind choice: kept Ctrl+T as a dedicated mode rather than overloading
// Ctrl+P with an `@` prefix. Reasoning: the `@` prefix flow proposed in
// `project_daisu_palette.md` requires intercepting query parsing inside
// CommandPalette and would couple symbol indexing to the existing palette's
// fuzzysort path. A standalone palette keeps Phase 4 self-contained and
// trivially removable if the design lands differently.

import type { JSX, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { usePalette } from "../../stores/paletteStore";
import { useWorkspace } from "../../stores/workspaceStore";
import { useTabs } from "../../stores/tabsStore";
import { getActiveEditor } from "../../lib/monaco-editor-ref";
import { indexSearch, type SymbolHit } from "../../lib/agent-index";

const MAX_RESULTS = 50;
const DEBOUNCE_MS = 120;

export function SymbolSearchPalette(): JSX.Element | null {
  const open = usePalette((s) => s.open);
  const mode = usePalette((s) => s.mode);
  const query = usePalette((s) => s.query);
  const selectedIdx = usePalette((s) => s.selectedIdx);
  const setQuery = usePalette((s) => s.setQuery);
  const setSelectedIdx = usePalette((s) => s.setSelectedIdx);
  const closePalette = usePalette((s) => s.closePalette);

  const rootPath = useWorkspace((s) => s.rootPath);
  const openTab = useTabs((s) => s.openTab);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const [results, setResults] = useState<SymbolHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = open && mode === "symbols";

  // Debounced search: avoids hammering SQLite on every keystroke.
  useEffect(() => {
    if (!visible || !rootPath) {
      setResults([]);
      return;
    }
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    const handle = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      indexSearch(rootPath, query, MAX_RESULTS)
        .then((rows) => {
          setResults(rows);
          setLoading(false);
        })
        .catch((e: unknown) => {
          setError(String((e as Error).message ?? e));
          setResults([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [visible, query, rootPath]);

  // Keep selection in range as results change.
  useEffect(() => {
    if (selectedIdx >= results.length) {
      setSelectedIdx(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIdx, setSelectedIdx]);

  function relPath(hit: SymbolHit): string {
    return hit.path;
  }

  function commit(idx: number): void {
    const hit = results[idx];
    if (!hit || !rootPath) return;
    const sep = rootPath.includes("\\") ? "\\" : "/";
    const abs = `${rootPath}${sep}${hit.path.replace(/\//g, sep)}`;
    closePalette();
    void openTab(abs).then(() => {
      setTimeout(() => {
        const editor = getActiveEditor();
        if (editor) {
          editor.revealLineInCenter(hit.lineStart);
          editor.setPosition({ lineNumber: hit.lineStart, column: 1 });
        }
      }, 50);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(Math.min(results.length - 1, selectedIdx + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(Math.max(0, selectedIdx - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit(selectedIdx);
    }
  }

  // Scroll selected row into view.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLLIElement>(
      `li[data-idx="${selectedIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const placeholder = useMemo(() => {
    if (!rootPath) return "Abrí una carpeta para buscar símbolos";
    return "Buscar símbolo… (función, tipo, clase)";
  }, [rootPath]);

  if (!visible) return null;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && closePalette()}>
      <Dialog.Portal>
        <Dialog.Overlay className="daisu-palette-overlay" />
        <Dialog.Content
          className="daisu-palette"
          aria-label="Paleta de símbolos"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="daisu-palette-header">
            <span className="daisu-glyph" aria-hidden="true">
              号
            </span>
            <input
              ref={inputRef}
              type="text"
              className="daisu-palette-input"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              autoComplete="off"
              aria-label={placeholder}
              disabled={!rootPath}
            />
            <span className="daisu-palette-mode-hint" aria-hidden="true">
              Ctrl+T
            </span>
          </div>
          <ul className="daisu-palette-list" ref={listRef} role="listbox">
            {loading && (
              <li className="daisu-palette-empty">Buscando…</li>
            )}
            {!loading && error && (
              <li className="daisu-palette-empty">Error: {error}</li>
            )}
            {!loading && !error && results.length === 0 && query.trim() && (
              <li className="daisu-palette-empty">
                Sin coincidencias. Reindexá desde Configuración → IA.
              </li>
            )}
            {!loading && !error && results.length === 0 && !query.trim() && (
              <li className="daisu-palette-empty">
                Escribí para buscar símbolos del workspace
              </li>
            )}
            {!loading &&
              !error &&
              results.map((r, i) => (
                <li
                  key={`${r.path}:${r.lineStart}:${r.name}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === selectedIdx}
                  className={`daisu-palette-row${i === selectedIdx ? " is-selected" : ""}`}
                  onMouseEnter={() => setSelectedIdx(i)}
                  onClick={() => commit(i)}
                >
                  <MagnifyingGlass size={14} className="daisu-palette-icon" />
                  <span className="daisu-palette-label">
                    <span className="daisu-pill-muted mr-2">{r.kind}</span>
                    {r.name}
                  </span>
                  <span className="daisu-palette-meta">
                    {relPath(r)}:{r.lineStart}
                  </span>
                </li>
              ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
