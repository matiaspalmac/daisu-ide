import { type JSX, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Warning, XCircle, Info, Lightbulb } from "@phosphor-icons/react";
import { useDiagnostics, type UiDiagnostic } from "../../stores/diagnosticsStore";
import { useTabs } from "../../stores/tabsStore";

interface FileGroup {
  uri: string;
  name: string;
  rows: Array<{ d: UiDiagnostic; serverId: string }>;
}

function severityIcon(sev: number | undefined): JSX.Element {
  switch (sev ?? 1) {
    case 1:
      return <XCircle size={11} className="text-[var(--danger)]" />;
    case 2:
      return <Warning size={11} className="text-[var(--warn)]" />;
    case 3:
      return <Info size={11} className="text-[var(--fg-muted)]" />;
    default:
      return <Lightbulb size={11} className="text-[var(--fg-muted)]" />;
  }
}

function uriToPath(uri: string): string {
  // file:///C:/foo → C:/foo on win, /foo on unix.
  const u = uri.replace(/^file:\/\//, "");
  return decodeURIComponent(u.startsWith("/") && /^\/[a-zA-Z]:/.test(u) ? u.slice(1) : u);
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

export function ProblemsView(): JSX.Element {
  const { t } = useTranslation();
  const byKey = useDiagnostics((s) => s.byKey);
  const openTab = useTabs((s) => s.openTab);

  const groups = useMemo<FileGroup[]>(() => {
    const m = new Map<string, FileGroup>();
    for (const [key, diags] of Object.entries(byKey)) {
      const sep = key.lastIndexOf("|");
      const uri = key.slice(0, sep);
      const serverId = key.slice(sep + 1);
      const path = uriToPath(uri);
      let g = m.get(uri);
      if (!g) {
        g = { uri, name: basename(path), rows: [] };
        m.set(uri, g);
      }
      for (const d of diags) g.rows.push({ d, serverId });
    }
    // Sort rows per file: severity asc → line asc.
    for (const g of m.values()) {
      g.rows.sort((a, b) => {
        const sa = a.d.severity ?? 1;
        const sb = b.d.severity ?? 1;
        if (sa !== sb) return sa - sb;
        return a.d.range.start.line - b.d.range.start.line;
      });
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [byKey]);

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-[var(--fg-muted)]">
        {t("bottomPanel.problemsEmpty")}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto text-[11px]">
      {groups.map((g) => (
        <div key={g.uri} className="py-1">
          <div className="px-3 py-0.5 text-[var(--fg-secondary)] font-medium truncate">
            {g.name}
            <span className="ml-2 text-[var(--fg-muted)]">{uriToPath(g.uri)}</span>
          </div>
          {g.rows.map(({ d, serverId }, i) => (
            <button
              key={`${g.uri}-${i}`}
              type="button"
              className="flex items-start gap-2 w-full text-left px-6 py-0.5 hover:bg-[var(--bg-elevated)]"
              onClick={() => {
                void openTab(uriToPath(g.uri));
              }}
            >
              <span className="mt-[2px]">{severityIcon(d.severity)}</span>
              <span className="flex-1 truncate">
                <span>{d.message}</span>
                <span className="ml-2 text-[var(--fg-muted)]">
                  {serverId}
                  {d.code !== undefined ? `:${String(d.code)}` : ""}
                </span>
              </span>
              <span className="text-[var(--fg-muted)] tabular-nums">
                [{d.range.start.line + 1}, {d.range.start.character + 1}]
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
