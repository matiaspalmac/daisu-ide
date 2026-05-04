import type { JSX, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import fuzzysort from "fuzzysort";
import { Terminal, FileText } from "@phosphor-icons/react";
import { usePalette } from "../../stores/paletteStore";
import { useWorkspace } from "../../stores/workspaceStore";
import { useTabs } from "../../stores/tabsStore";
import { ACTIONS } from "../../lib/keybinding-registry";
import { runAction } from "../../lib/action-handlers";
import type { FileEntry } from "../../api/tauri";

const MAX_RESULTS = 50;

interface FileResult {
  kind: "file";
  path: string;
  name: string;
  rel: string;
}
interface CommandResult {
  kind: "command";
  id: string;
  label: string;
  category: string;
  binding: string;
}
type Result = FileResult | CommandResult;

function buildFiles(
  tree: Map<string, FileEntry>,
  rootPath: string | null,
): FileResult[] {
  if (!rootPath) return [];
  const out: FileResult[] = [];
  for (const [path, entry] of tree) {
    if (entry.kind !== "file") continue;
    const rel = path.startsWith(rootPath)
      ? path.slice(rootPath.length).replace(/^[\\/]/, "")
      : path;
    out.push({ kind: "file", path, name: entry.name, rel });
  }
  return out;
}

function buildCommands(): CommandResult[] {
  return ACTIONS.map((a) => ({
    kind: "command" as const,
    id: a.id,
    label: a.label,
    category: a.category,
    binding: a.defaultBinding.replace(/\$mod/g, "Ctrl"),
  }));
}

export function CommandPalette(): JSX.Element | null {
  const open = usePalette((s) => s.open);
  const mode = usePalette((s) => s.mode);
  const query = usePalette((s) => s.query);
  const selectedIdx = usePalette((s) => s.selectedIdx);
  const setQuery = usePalette((s) => s.setQuery);
  const setSelectedIdx = usePalette((s) => s.setSelectedIdx);
  const closePalette = usePalette((s) => s.closePalette);

  const tree = useWorkspace((s) => s.tree);
  const rootPath = useWorkspace((s) => s.rootPath);
  const openTab = useTabs((s) => s.openTab);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const fileIndex = useMemo(() => buildFiles(tree, rootPath), [tree, rootPath]);
  const commandIndex = useMemo(buildCommands, []);

  const results: Result[] = useMemo(() => {
    if (mode === "files") {
      if (!query) return fileIndex.slice(0, MAX_RESULTS);
      const matches = fuzzysort.go(query, fileIndex, {
        keys: ["rel", "name"],
        limit: MAX_RESULTS,
        threshold: -10000,
      });
      return matches.map((m) => m.obj);
    }
    if (!query) return commandIndex.slice(0, MAX_RESULTS);
    const matches = fuzzysort.go(query, commandIndex, {
      keys: ["label", "id"],
      limit: MAX_RESULTS,
      threshold: -10000,
    });
    return matches.map((m) => m.obj);
  }, [mode, query, fileIndex, commandIndex]);

  // Keep selection inside the visible result range when results change.
  useEffect(() => {
    if (selectedIdx >= results.length) {
      setSelectedIdx(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIdx, setSelectedIdx]);

  // Scroll selected row into view as user navigates.
  const [scrollKey, setScrollKey] = useState(0);
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLLIElement>(
      `li[data-idx="${selectedIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx, scrollKey]);

  // Reset scroll when palette opens or mode changes.
  useEffect(() => {
    if (open) setScrollKey((k) => k + 1);
  }, [open, mode]);

  function commit(idx: number): void {
    const r = results[idx];
    if (!r) return;
    if (r.kind === "file") {
      void openTab(r.path);
    } else {
      void runAction(r.id);
    }
    closePalette();
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

  if (!open) return null;
  // SymbolSearchPalette owns the "symbols" mode.
  if (mode === "symbols") return null;

  const placeholder =
    mode === "files"
      ? rootPath
        ? "Buscar archivo…"
        : "Abrí una carpeta para buscar archivos"
      : "Buscar comando…";
  const headerGlyph = mode === "files" ? "索" : "命";
  const headerLabel = mode === "files" ? "Archivos" : "Comandos";

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closePalette()}>
      <Dialog.Portal>
        <Dialog.Overlay className="daisu-palette-overlay" />
        <Dialog.Content
          className="daisu-palette"
          aria-label={`Paleta de ${headerLabel}`}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="daisu-palette-header">
            <span className="daisu-glyph" aria-hidden="true">
              {headerGlyph}
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
            />
            <span className="daisu-palette-mode-hint" aria-hidden="true">
              {mode === "files" ? "Ctrl+P" : "Ctrl+Shift+P"}
            </span>
          </div>
          <ul className="daisu-palette-list" ref={listRef} role="listbox">
            {results.length === 0 && (
              <li className="daisu-palette-empty">Sin coincidencias</li>
            )}
            {results.map((r, i) => (
              <li
                key={r.kind === "file" ? r.path : r.id}
                data-idx={i}
                role="option"
                aria-selected={i === selectedIdx}
                className={`daisu-palette-row${i === selectedIdx ? " is-selected" : ""}`}
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => commit(i)}
              >
                {r.kind === "file" ? (
                  <FileResultRow result={r} />
                ) : (
                  <CommandResultRow result={r} />
                )}
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FileResultRow({ result }: { result: FileResult }): JSX.Element {
  const dir = result.rel.includes("/") || result.rel.includes("\\")
    ? result.rel.replace(/[\\/][^\\/]+$/, "")
    : "";
  return (
    <>
      <FileText size={14} className="daisu-palette-icon" />
      <span className="daisu-palette-label">{result.name}</span>
      {dir && <span className="daisu-palette-meta">{dir}</span>}
    </>
  );
}

function CommandResultRow({ result }: { result: CommandResult }): JSX.Element {
  return (
    <>
      <Terminal size={14} className="daisu-palette-icon" />
      <span className="daisu-palette-label">{result.label}</span>
      <span className="daisu-palette-meta">{result.category}</span>
      {result.binding && (
        <span className="daisu-palette-kbd">{result.binding}</span>
      )}
    </>
  );
}

