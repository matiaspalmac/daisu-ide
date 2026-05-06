import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import fuzzysort from "fuzzysort";
import { useTranslation } from "react-i18next";
import { lspDocumentSymbol, listServerStatus, type ServerStatus } from "../../lib/lsp";
import { usePalette } from "../../stores/paletteStore";
import { useTabs } from "../../stores/tabsStore";
import { getActiveEditor } from "../../lib/monaco-editor-ref";
import { iconForSymbolKind } from "../../lsp/symbolIcons";
import { lspRangeToMonaco } from "../../lsp/positions";
import type {
  LspDocumentSymbol,
  LspDocumentSymbolResponse,
  LspRange,
  LspSymbolInformation,
} from "../../lsp/types";

interface FlatSymbolRow {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  detail: string;
  depth: number;
}

const KIND_PREFIX_RE = /^:(\w+)\s+(.*)$/;

const KIND_FAMILY_QUERY: Record<string, number[]> = {
  func: [12, 6, 9],
  class: [5, 11, 23, 10],
  field: [8, 7, 13, 14],
  type: [26, 18, 19, 20],
  file: [1, 2, 3, 4],
};

function flatten(syms: LspDocumentSymbol[], depth = 0, out: FlatSymbolRow[] = []): FlatSymbolRow[] {
  for (const s of syms) {
    out.push({
      name: s.name,
      kind: s.kind,
      range: s.range,
      selectionRange: s.selectionRange,
      detail: s.detail ?? "",
      depth: Math.min(depth, 5),
    });
    if (s.children && s.children.length > 0) flatten(s.children, depth + 1, out);
  }
  return out;
}

function flattenResponse(res: LspDocumentSymbolResponse): FlatSymbolRow[] {
  if (res.length === 0) return [];
  if ("selectionRange" in res[0]!) return flatten(res as LspDocumentSymbol[]);
  return (res as LspSymbolInformation[]).map((s) => ({
    name: s.name,
    kind: s.kind,
    range: s.location.range,
    selectionRange: s.location.range,
    detail: s.containerName ?? "",
    depth: 0,
  }));
}

export function FileSymbolPalette(): JSX.Element | null {
  const { t } = useTranslation();
  const open = usePalette((s) => s.open);
  const mode = usePalette((s) => s.mode);
  const query = usePalette((s) => s.query);
  const selectedIdx = usePalette((s) => s.selectedIdx);
  const setQuery = usePalette((s) => s.setQuery);
  const setSelectedIdx = usePalette((s) => s.setSelectedIdx);
  const closePalette = usePalette((s) => s.closePalette);

  const activeTabId = useTabs((s) => s.activeTabId);
  const tabs = useTabs((s) => s.tabs);

  const [rows, setRows] = useState<FlatSymbolRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isOpen = open && mode === "fileSymbols";
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId),
    [tabs, activeTabId],
  );

  useEffect(() => {
    if (!isOpen || !activeTab || !activeTab.path) return;
    const path = activeTab.path;
    const language = activeTab.language;
    let cancelled = false;
    setLoading(true);
    setSupported(true);
    void (async () => {
      const statuses = await listServerStatus().catch(() => [] as ServerStatus[]);
      const target = statuses.find(
        (s) =>
          s.state === "ready" &&
          s.capabilities.documentSymbol &&
          s.languages.includes(language),
      );
      if (!target) {
        if (!cancelled) {
          setRows([]);
          setSupported(false);
          setLoading(false);
        }
        return;
      }
      const res = await lspDocumentSymbol(path, target.serverId).catch(() => null);
      if (cancelled) return;
      setRows(res ? flattenResponse(res) : []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTab]);

  const filtered = useMemo(() => {
    if (rows.length === 0) return [];
    const m = KIND_PREFIX_RE.exec(query);
    let kindFilter: number[] | null = null;
    let q = query;
    if (m) {
      const fam = KIND_FAMILY_QUERY[m[1]!.toLowerCase()];
      if (fam) {
        kindFilter = fam;
        q = m[2] ?? "";
      }
    }
    const pool = kindFilter ? rows.filter((r) => kindFilter!.includes(r.kind)) : rows;
    if (q.trim().length === 0) return pool.slice(0, 200);
    const ranked = fuzzysort.go(q, pool, { key: "name", limit: 200 });
    return ranked.map((r) => r.obj);
  }, [rows, query]);

  function jumpTo(row: FlatSymbolRow): void {
    const editor = getActiveEditor();
    if (!editor) {
      closePalette();
      return;
    }
    const range = lspRangeToMonaco(row.selectionRange);
    editor.revealRangeInCenter(range);
    editor.setPosition({ lineNumber: range.startLineNumber, column: range.startColumn });
    editor.focus();
    closePalette();
  }

  if (!isOpen) return null;

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) closePalette(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-[600px] max-w-[90vw] bg-daisu-bg border border-daisu-border rounded shadow-xl"
          aria-label={t("palette.fileSymbols.placeholder")}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered[selectedIdx]) jumpTo(filtered[selectedIdx]!);
              else if (e.key === "ArrowDown") setSelectedIdx(Math.min(selectedIdx + 1, filtered.length - 1));
              else if (e.key === "ArrowUp") setSelectedIdx(Math.max(selectedIdx - 1, 0));
            }}
            placeholder={t("palette.fileSymbols.placeholder") ?? ""}
            className="w-full bg-transparent border-b border-daisu-border px-3 py-2 outline-none"
            autoFocus
          />
          <ul className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <li className="px-3 py-2 text-daisu-fg-muted">…</li>
            ) : !supported ? (
              <li className="px-3 py-2 text-daisu-fg-muted">{t("palette.fileSymbols.notSupported")}</li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-2 text-daisu-fg-muted">{t("palette.fileSymbols.empty")}</li>
            ) : (
              filtered.map((row, i) => {
                const meta = iconForSymbolKind(row.kind);
                const Icon = meta.Icon;
                return (
                  <li
                    key={`${row.name}-${row.range.start.line}-${i}`}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${i === selectedIdx ? "bg-daisu-bg-muted" : ""}`}
                    style={{ paddingLeft: `${12 + row.depth * 8}px` }}
                    onClick={() => jumpTo(row)}
                    onMouseEnter={() => setSelectedIdx(i)}
                  >
                    <Icon size={14} className={meta.colorClass} />
                    <span className="flex-1">{row.name}</span>
                    {row.detail && <span className="text-daisu-fg-muted text-sm">{row.detail}</span>}
                  </li>
                );
              })
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
