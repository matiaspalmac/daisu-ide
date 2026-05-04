import { useEffect, useState, type JSX } from "react";
import { listen } from "@tauri-apps/api/event";
import { Plugs } from "@phosphor-icons/react";
import { useSettings } from "../../stores/settingsStore";
import { mcpStatus, type McpStatusInfo } from "../../lib/agent-mcp";

const STATUS_EVENT = "agent://mcp-status";

/**
 * Tiny status-bar segment showing how many MCP servers are connected
 * out of how many are configured. Hidden when no servers are configured.
 */
export function McpStatusChip(): JSX.Element | null {
  const configured = useSettings((s) => s.settings.mcp.servers);
  const [statuses, setStatuses] = useState<McpStatusInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    void mcpStatus()
      .then((s) => {
        if (!cancelled) setStatuses(s);
      })
      .catch(() => {
        /* ignore */
      });

    const unlistenPromise = listen(STATUS_EVENT, () => {
      void mcpStatus()
        .then((s) => {
          if (!cancelled) setStatuses(s);
        })
        .catch(() => {
          /* ignore */
        });
    });

    return () => {
      cancelled = true;
      void unlistenPromise.then((un) => un()).catch(() => {
        /* ignore */
      });
    };
  }, []);

  if (configured.length === 0) return null;

  const connected = statuses.filter((s) => s.connected).length;
  const total = configured.length;
  const ok = connected > 0;

  return (
    <span
      className="h-5 px-1.5 inline-flex items-center gap-1 text-[11px] rounded-[var(--radius-sm)]"
      style={{
        color: ok ? "var(--ok, var(--fg-secondary))" : "var(--fg-muted)",
      }}
      title={`MCP: ${connected}/${total} servers connected`}
      aria-label={`MCP: ${connected} of ${total} servers connected`}
    >
      <Plugs size={12} />
      <span>
        {connected}/{total}
      </span>
    </span>
  );
}
