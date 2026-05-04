import { useEffect, useRef } from "react";
import {
  discordClearActivityCmd,
  discordConnectCmd,
  discordDisconnectCmd,
  discordSetActivityCmd,
  type DiscordActivityPayload,
} from "../api/tauri";
import { useSettings } from "../stores/settingsStore";
import { useTabs } from "../stores/tabsStore";
import { useWorkspace } from "../stores/workspaceStore";
import { isTauri } from "../lib/tauri-env";

const UPDATE_INTERVAL_MS = 15_000;
const LARGE_IMAGE_KEY = "daisu";
const LARGE_TEXT = "Daisu IDE";

function basename(p: string | null | undefined): string | null {
  if (!p) return null;
  const m = p.split(/[\\/]/);
  return m[m.length - 1] ?? null;
}

/**
 * Maintains the Discord IPC connection and pushes activity updates whenever
 * the active tab or workspace changes. Throttled to one update per 15s to
 * stay under Discord's rate limit. Disconnects cleanly on unmount.
 */
export function useDiscordRpc(): void {
  const enabled = useSettings((s) => s.settings.integrations.discordRpcEnabled);
  const appId = useSettings((s) => s.settings.integrations.discordAppId);
  const showFile = useSettings((s) => s.settings.integrations.discordShowFile);
  const showProject = useSettings((s) => s.settings.integrations.discordShowProject);
  const activeTabId = useTabs((s) => s.activeTabId);
  const tabs = useTabs((s) => s.tabs);
  const rootPath = useWorkspace((s) => s.rootPath);

  const startTsRef = useRef<number>(Math.floor(Date.now() / 1000));
  const lastSentRef = useRef<number>(0);
  const pendingTimerRef = useRef<number | null>(null);
  const connectedRef = useRef<boolean>(false);

  // Connect / reconnect when enabled flag or appId changes. Defer the first
  // attempt by 1.5s so the app paints, the editor mounts, and the user is
  // interactive before any potentially slow IPC handshake runs.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let delayHandle: number | null = null;
    if (!enabled || !appId) {
      void discordDisconnectCmd().catch(() => undefined);
      connectedRef.current = false;
      return () => {
        cancelled = true;
      };
    }
    delayHandle = window.setTimeout(() => {
      if (cancelled) return;
      void discordConnectCmd(appId)
        .then(() => {
          if (!cancelled) {
            connectedRef.current = true;
            startTsRef.current = Math.floor(Date.now() / 1000);
          }
        })
        .catch(() => {
          // Discord not running or socket unavailable — silently skip.
          connectedRef.current = false;
        });
    }, 1500);
    return () => {
      cancelled = true;
      if (delayHandle !== null) window.clearTimeout(delayHandle);
    };
  }, [enabled, appId]);

  // Disconnect on unmount.
  useEffect(() => {
    return () => {
      void discordDisconnectCmd().catch(() => undefined);
    };
  }, []);

  // Push activity updates throttled to once per UPDATE_INTERVAL_MS.
  useEffect(() => {
    if (!isTauri() || !enabled) return;
    const projectName = showProject ? basename(rootPath) : null;
    const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : null;
    const fileName = showFile ? activeTab?.name ?? null : null;

    // Layout mirrors Zed/VS Code RPC convention:
    //   bold title (app name)  ← "Daisu" (auto from Discord app)
    //   details                ← "In <project>"
    //   state                  ← "Editing <file>" or "Idling"
    const payload: DiscordActivityPayload = {
      details: `In ${projectName ?? "Daisu"}`,
      state: fileName ? `Editing ${fileName}` : "Idling",
      startTimestamp: startTsRef.current,
      largeImage: LARGE_IMAGE_KEY,
      largeText: LARGE_TEXT,
      smallImage: fileName ? "edit" : "moon",
      smallText: fileName ? "Editing" : "Idle",
    };

    const send = (): void => {
      lastSentRef.current = Date.now();
      pendingTimerRef.current = null;
      if (!connectedRef.current) return;
      void discordSetActivityCmd(payload).catch(() => {
        connectedRef.current = false;
      });
    };

    const elapsed = Date.now() - lastSentRef.current;
    if (elapsed >= UPDATE_INTERVAL_MS) {
      send();
    } else {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
      }
      pendingTimerRef.current = window.setTimeout(send, UPDATE_INTERVAL_MS - elapsed);
    }

    return () => {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [enabled, activeTabId, tabs, rootPath, showFile, showProject]);

  // Clear activity when disabled but client still connected.
  useEffect(() => {
    if (!isTauri()) return;
    if (!enabled && connectedRef.current) {
      void discordClearActivityCmd().catch(() => undefined);
    }
  }, [enabled]);
}
