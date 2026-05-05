// LSP-backed workspace symbol palette (Ctrl+Shift+T).
//
// Complements the M3 agent-index `SymbolSearchPalette` (Ctrl+T): when LSP
// servers are running, this palette returns ground-truth symbols across
// every ready server in parallel; the agent-index palette continues to
// serve workspaces without trusted LSPs.

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import fuzzysort from "fuzzysort";
import { useTranslation } from "react-i18next";
import { lspWorkspaceSymbol, listServerStatus, type ServerStatus } from "../../lib/lsp";
import { usePalette } from "../../stores/paletteStore";
import { useTabs } from "../../stores/tabsStore";
import { getActiveEditor } from "../../lib/monaco-editor-ref";
import { iconForSymbolKind } from "../../lsp/symbolIcons";
import { lspRangeToMonaco } from "../../lsp/positions";
import type {
  LspRange,
  LspSymbolInformation,
  LspWorkspaceSymbol,
  LspWorkspaceSymbolResponse,
} from "../../lsp/types";

interface SymbolHit {
  name: string;
  kind: number;
  uri: string;
  range: LspRange;
  container: string;
}

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;
const RESULT_CAP = 100;

function normalizeWorkspaceSymbols(res: LspWorkspaceSymbolResponse | null): SymbolHit[] {
  if (!res) return [];
  return res.map((s) => {
    if ("location" in s && "range" in s.location) {
      const flat = s as LspSymbolInformation;
      return {
        name: flat.name,
        kind: flat.kind,
        uri: flat.location.uri,
        range: flat.location.range,
        container: flat.containerName ?? "",
      };
    }
    const ws = s as LspWorkspaceSymbol;
    const range: LspRange =
      "range" in ws.location
        ? ws.location.range
        : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    return {
      name: ws.name,
      kind: ws.kind,
      uri: ws.location.uri,
      range,
      container: ws.containerName ?? "",
    };
  });
}

function uriToPath(uri: string): string {
  return uri.replace(/^file:\/\//, "").replace(/^\/([A-Za-z]:)/, "$1");
}

export function LspWorkspaceSymbolPalette(): JSX.Element | null {
  const { t } = useTranslation();
  const open = usePalette((s) => s.open);
  const mode = usePalette((s) => s.mode);
  const query = usePalette((s) => s.query);
  const selectedIdx = usePalette((s) => s.selectedIdx);
  const setQuery = usePalette((s) => s.setQuery);
  const setSelectedIdx = usePalette((s) => s.setSelectedIdx);
  const closePalette = usePalette((s) => s.closePalette);
  const openTab = useTabs((s) => s.openTab);

  const [hits, setHits] = useState<SymbolHit[]>([]);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isOpen = open && mode === "lspSymbols";

  useEffect(() => {
    if (!isOpen) return;
    if (query.length < MIN_CHARS) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    seqRef.current += 1;
    const seq = seqRef.current;
    const handle = setTimeout(async () => {
      const statuses = await listServerStatus().catch(() => [] as ServerStatus[]);
      const targets = statuses.filter(
        (s) => s.state === "ready" && s.capabilities.workspaceSymbol,
      );
      if (targets.length === 0) {
        if (seq === seqRef.current) {
          setHits([]);
          setLoading(false);
        }
        return;
      }
      const responses = await Promise.allSettled(
        targets.map((s) => lspWorkspaceSymbol(query, s.serverId)),
      );
      if (seq !== seqRef.current) return;
      const merged: SymbolHit[] = [];
      for (const r of responses) {
        if (r.status === "fulfilled") merged.push(...normalizeWorkspaceSymbols(r.value));
      }
      const ranked = fuzzysort.go(query, merged, { key: "name", limit: RESULT_CAP });
      setHits(ranked.map((r) => r.obj));
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [isOpen, query]);

  function jumpTo(hit: SymbolHit): void {
    const path = uriToPath(hit.uri);
    void (async () => {
      await openTab(path);
      // Wait one tick for the editor to bind to the new tab.
      setTimeout(() => {
        const editor = getActiveEditor();
        if (!editor) return;
        const range = lspRangeToMonaco(hit.range);
        editor.revealRangeInCenter(range);
        editor.setPosition({ lineNumber: range.startLineNumber, column: range.startColumn });
        editor.focus();
      }, 0);
      closePalette();
    })();
  }

  if (!isOpen) return null;

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) closePalette(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-[600px] max-w-[90vw] bg-daisu-bg border border-daisu-border rounded shadow-xl"
          aria-label={t("palette.lspSymbols.placeholder")}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[selectedIdx]) jumpTo(hits[selectedIdx]!);
              else if (e.key === "ArrowDown") setSelectedIdx(Math.min(selectedIdx + 1, hits.length - 1));
              else if (e.key === "ArrowUp") setSelectedIdx(Math.max(selectedIdx - 1, 0));
            }}
            placeholder={t("palette.lspSymbols.placeholder") ?? ""}
            className="w-full bg-transparent border-b border-daisu-border px-3 py-2 outline-none"
            autoFocus
          />
          <ul className="max-h-[400px] overflow-y-auto">
            {query.length < MIN_CHARS ? (
              <li className="px-3 py-2 text-daisu-fg-muted">{t("palette.lspSymbols.minChars")}</li>
            ) : loading ? (
              <li className="px-3 py-2 text-daisu-fg-muted">…</li>
            ) : hits.length === 0 ? (
              <li className="px-3 py-2 text-daisu-fg-muted">{t("palette.lspSymbols.empty")}</li>
            ) : (
              hits.map((hit, i) => {
                const meta = iconForSymbolKind(hit.kind);
                const Icon = meta.Icon;
                return (
                  <li
                    key={`${hit.uri}-${hit.range.start.line}-${i}`}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${i === selectedIdx ? "bg-daisu-bg-muted" : ""}`}
                    onClick={() => jumpTo(hit)}
                    onMouseEnter={() => setSelectedIdx(i)}
                  >
                    <Icon size={14} className={meta.colorClass} />
                    <span className="flex-1">{hit.name}</span>
                    {hit.container && <span className="text-daisu-fg-muted text-sm">{hit.container}</span>}
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
