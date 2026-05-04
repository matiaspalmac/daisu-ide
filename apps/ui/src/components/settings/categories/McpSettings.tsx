import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Plugs, PlugsConnected, Trash, PencilSimple } from "@phosphor-icons/react";
import { useSettings } from "../../../stores/settingsStore";
import {
  mcpConnect,
  mcpDisconnect,
  mcpStatus,
  type McpServerConfig,
  type McpStatusInfo,
} from "../../../lib/agent-mcp";
import { translateError } from "../../../lib/error-translate";

interface DraftServer {
  name: string;
  transport: "stdio" | "sse";
  command: string;
  argsRaw: string;
  envRaw: string;
  url: string;
}

const EMPTY_DRAFT: DraftServer = {
  name: "",
  transport: "stdio",
  command: "",
  argsRaw: "",
  envRaw: "",
  url: "",
};

// Args are entered one per line so paths with spaces (Windows) survive
// intact. Splitting on any whitespace would shatter "C:\Program Files".
function parseArgs(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function McpSettings(): JSX.Element {
  const { t } = useTranslation();
  const servers = useSettings((s) => s.settings.mcp.servers);
  const setSetting = useSettings((s) => s.set);
  const [statuses, setStatuses] = useState<McpStatusInfo[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftServer>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void mcpStatus()
      .then((s) => {
        if (!cancelled) setStatuses(s);
      })
      .catch(() => {
        /* swallow — status is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function statusFor(name: string): McpStatusInfo | undefined {
    return statuses.find((s) => s.name === name);
  }

  async function refreshStatus(): Promise<void> {
    try {
      setStatuses(await mcpStatus());
    } catch {
      /* ignore */
    }
  }

  function startEdit(idx: number): void {
    const s = servers[idx];
    if (!s) return;
    setDraft({
      name: s.name,
      transport: s.transport,
      command: s.command,
      argsRaw: s.args.join("\n"),
      envRaw: envToText(s.env),
      url: s.url ?? "",
    });
    setEditingIndex(idx);
    setAdding(false);
    setError(null);
  }

  function startAdd(): void {
    setDraft(EMPTY_DRAFT);
    setAdding(true);
    setEditingIndex(null);
    setError(null);
  }

  function cancelDraft(): void {
    setAdding(false);
    setEditingIndex(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  }

  async function saveDraft(): Promise<void> {
    const name = draft.name.trim();
    if (!name) {
      setError(t("mcp.nameRequired"));
      return;
    }
    const next: McpServerConfig = {
      name,
      transport: draft.transport,
      command: draft.command.trim(),
      args: parseArgs(draft.argsRaw),
      env: parseEnv(draft.envRaw),
      url: draft.url.trim() ? draft.url.trim() : undefined,
      enabled: true,
    };
    const list = [...servers];
    if (editingIndex !== null) {
      list[editingIndex] = { ...list[editingIndex], ...next };
    } else {
      if (list.some((s) => s.name === name)) {
        setError(t("mcp.duplicate"));
        return;
      }
      list.push(next);
    }
    await setSetting("mcp", { servers: list });
    cancelDraft();
  }

  async function removeServer(idx: number): Promise<void> {
    const target = servers[idx];
    if (!target) return;
    if (statusFor(target.name)?.connected) {
      try {
        await mcpDisconnect(target.name);
      } catch {
        /* continue */
      }
    }
    const list = servers.filter((_, i) => i !== idx);
    await setSetting("mcp", { servers: list });
    await refreshStatus();
  }

  async function toggleConnect(idx: number): Promise<void> {
    const target = servers[idx];
    if (!target) return;
    const connected = statusFor(target.name)?.connected ?? false;
    try {
      if (connected) {
        await mcpDisconnect(target.name);
      } else {
        await mcpConnect(target);
      }
      await refreshStatus();
    } catch (e) {
      setError(translateError(e));
    }
  }

  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">MCP</h2>
      <p className="daisu-settings-section-desc">{t("mcp.hint")}</p>

      {error && (
        <div className="daisu-field-error" role="alert">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2 mt-2">
        {servers.length === 0 && (
          <p className="text-[var(--fg-muted)] text-[12px]">{t("mcp.noServers")}</p>
        )}
        {servers.map((s, idx) => {
          const st = statusFor(s.name);
          return (
            <div
              key={s.name}
              className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-panel)]"
            >
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[12px] font-medium truncate">
                  {s.name}
                  <span className="ml-2 text-[10px] text-[var(--fg-muted)] uppercase">
                    {s.transport}
                  </span>
                </span>
                <span className="text-[10px] text-[var(--fg-muted)] truncate">
                  {s.transport === "stdio"
                    ? `${s.command} ${s.args.join(" ")}`.trim() || t("mcp.noCommand")
                    : (s.url ?? t("mcp.noUrl"))}
                </span>
              </div>
              <span
                className={`text-[10px] ${
                  st?.connected
                    ? "text-[var(--ok)]"
                    : "text-[var(--fg-muted)]"
                }`}
              >
                {st?.connected ? t("mcp.tools", { count: st.toolCount }) : t("mcp.off")}
              </span>
              <button
                type="button"
                className="daisu-icon-btn"
                title={st?.connected ? t("mcp.disconnect") : t("mcp.connect")}
                aria-label={st?.connected ? t("mcp.disconnect") : t("mcp.connect")}
                onClick={() => void toggleConnect(idx)}
              >
                {st?.connected ? <PlugsConnected size={14} /> : <Plugs size={14} />}
              </button>
              <button
                type="button"
                className="daisu-icon-btn"
                title={t("mcp.edit")}
                aria-label={t("mcp.edit")}
                onClick={() => startEdit(idx)}
              >
                <PencilSimple size={14} />
              </button>
              <button
                type="button"
                className="daisu-icon-btn"
                title={t("mcp.deleteAria")}
                aria-label={t("mcp.deleteAria")}
                onClick={() => void removeServer(idx)}
              >
                <Trash size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {!adding && editingIndex === null && (
        <button
          type="button"
          className="daisu-btn mt-3 inline-flex items-center gap-1"
          onClick={startAdd}
        >
          <Plus size={12} /> {t("mcp.addServer")}
        </button>
      )}

      {(adding || editingIndex !== null) && (
        <div className="daisu-field flex-col gap-2 mt-3 p-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
          <label className="daisu-field-label">{t("mcp.name")}</label>
          <input
            className="daisu-input daisu-input-mono"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            spellCheck={false}
          />

          <label className="daisu-field-label">{t("mcp.transport")}</label>
          <select
            className="daisu-input"
            value={draft.transport}
            onChange={(e) =>
              setDraft({
                ...draft,
                transport: e.target.value === "sse" ? "sse" : "stdio",
              })
            }
          >
            <option value="stdio">{t("mcp.transportStdio")}</option>
            <option value="sse">{t("mcp.transportSse")}</option>
          </select>

          {draft.transport === "stdio" ? (
            <>
              <label className="daisu-field-label">{t("mcp.command")}</label>
              <input
                className="daisu-input daisu-input-mono"
                value={draft.command}
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                spellCheck={false}
                placeholder="npx"
              />

              <label className="daisu-field-label">{t("mcp.argsLabel")}</label>
              <textarea
                className="daisu-input daisu-input-mono"
                rows={3}
                value={draft.argsRaw}
                onChange={(e) => setDraft({ ...draft, argsRaw: e.target.value })}
                spellCheck={false}
                placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/dir"
              />

              <label className="daisu-field-label">{t("mcp.envLabel")}</label>
              <textarea
                className="daisu-input daisu-input-mono"
                rows={3}
                value={draft.envRaw}
                onChange={(e) => setDraft({ ...draft, envRaw: e.target.value })}
                spellCheck={false}
              />
            </>
          ) : (
            <>
              <label className="daisu-field-label">{t("mcp.url")}</label>
              <input
                className="daisu-input daisu-input-mono"
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                spellCheck={false}
                placeholder="https://example.com/mcp"
              />
            </>
          )}

          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              className="daisu-btn"
              onClick={() => void saveDraft()}
            >
              {t("common.save")}
            </button>
            <button type="button" className="daisu-btn" onClick={cancelDraft}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
