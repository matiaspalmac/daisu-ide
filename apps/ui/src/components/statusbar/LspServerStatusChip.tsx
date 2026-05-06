import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { WarningOctagon } from "@phosphor-icons/react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkspace } from "../../stores/workspaceStore";
import { listServerStatus, type ServerStatus } from "../../lib/lsp";

const chipCls =
  "h-5 px-1.5 inline-flex items-center gap-1 text-[11px] rounded-[var(--radius-sm)] " +
  "text-[var(--danger)] bg-[var(--danger-soft,rgba(255,80,80,0.12))] border border-[var(--danger)] " +
  "hover:bg-[var(--danger)] hover:text-[var(--bg-base)] transition-colors";

// Poll cadence is intentionally slow (15s) — the chip's job is to surface
// crashed servers, and the `lsp://server-ready` / `lsp://workspace-opened`
// event listeners below already deliver transitions in real time. The
// previous 3s value showed up in DevTools HAR captures as ~20 IPC calls
// per minute of idle time, eating Tauri thread budget for nothing. A 15s
// fallback only matters if the backend exits without firing any event,
// which is rare; the user notices a crash through editor diagnostics
// long before the chip appears anyway.
const POLL_MS = 15000;

/**
 * Status-bar chip surfacing crashed LSP servers. Mirrors `LspTrustChip`'s
 * mount/unmount pattern but for backend failures (handshake timeout,
 * server exited before initialize, missing binary). Without this the user
 * sees the bottom panel sit empty after editing a `.rs` file with no
 * indication that rust-analyzer never spawned — the exact symptom that
 * blocks the rustup-proxy-stub case.
 */
export function LspServerStatusChip(): JSX.Element | null {
  const { t } = useTranslation();
  const rootPath = useWorkspace((s) => s.rootPath);
  const [crashed, setCrashed] = useState<ServerStatus[]>([]);

  useEffect(() => {
    if (!rootPath) {
      setCrashed([]);
      return;
    }
    let cancelled = false;
    let unlistenReady: UnlistenFn | null = null;
    let unlistenOpened: UnlistenFn | null = null;

    const refresh = async (): Promise<void> => {
      try {
        const statuses = await listServerStatus();
        if (cancelled) return;
        setCrashed(statuses.filter((s) => s.state === "crashed"));
      } catch {
        /* backend transiently unavailable — next tick will retry */
      }
    };

    void refresh();
    const interval = window.setInterval(refresh, POLL_MS);
    // Backend events fire on transitions but not on Crashed yet; the poll
    // is the source of truth, the listeners are just opportunistic
    // refreshes that shrink the crash → UI window from ~POLL_MS to ~0.
    void listen("lsp://server-ready", () => void refresh()).then((u) => {
      unlistenReady = u;
    });
    void listen("lsp://workspace-opened", () => void refresh()).then((u) => {
      unlistenOpened = u;
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (unlistenReady) unlistenReady();
      if (unlistenOpened) unlistenOpened();
    };
  }, [rootPath]);

  if (crashed.length === 0) return null;

  const tooltip = crashed
    .map((s) => `${s.serverId}: ${s.lastError ?? "crashed"}`)
    .join("\n");
  const label = t("lsp.serverErrorChip", { count: crashed.length });

  return (
    <button
      type="button"
      className={chipCls}
      title={tooltip}
      aria-label={label}
    >
      <WarningOctagon size={11} weight="fill" />
      <span>
        LSP
        {crashed.length > 1 ? ` ×${crashed.length}` : ""}
      </span>
    </button>
  );
}
