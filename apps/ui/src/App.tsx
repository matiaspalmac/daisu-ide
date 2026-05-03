import type { JSX } from "react";
import { useEffect } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { listen } from "@tauri-apps/api/event";
import { TitleBar } from "./components/layout/TitleBar";
import { Toolbar } from "./components/layout/Toolbar";
import { Sidebar } from "./components/layout/Sidebar";
import { EditorArea } from "./components/layout/EditorArea";
import { AgentsPanel } from "./components/layout/AgentsPanel";
import { StatusBar } from "./components/layout/StatusBar";
import { SearchPanel } from "./components/layout/SearchPanel";
import { ToastViewport } from "./components/ui/Toast";
import { CloseConfirmModal } from "./components/tabs/CloseConfirmModal";
import { SettingsModal } from "./components/settings/SettingsModal";
import { useUI } from "./stores/uiStore";
import { useSettings } from "./stores/settingsStore";
import { useWorkspace } from "./stores/workspaceStore";
import { useTabs } from "./stores/tabsStore";
import { useKeybindings } from "./hooks/useKeybindings";
import { useTheme } from "./hooks/useTheme";
import { useGitWatcher } from "./hooks/useGitWatcher";
import { useEditorCursorWiring } from "./hooks/useEditorCursor";
import { useGit } from "./stores/gitStore";
import { copy } from "./lib/copy";

// Note: react-resizable-panels v4 uses percentage-string sizing.
// We use useDefaultLayout({ groupId, storage }) to persist sizes to
// localStorage instead of syncing to Zustand on every drag (avoids
// feedback loops). Approximate percent defaults assume a ~1280px window:
//   240/1280 ≈ 19% sidebar, 320/1280 ≈ 25% agents.

export function App(): JSX.Element {
  useKeybindings();
  useTheme();
  useGitWatcher();
  useEditorCursorWiring();
  const sidebarCollapsed = useUI((s) => s.sidebarCollapsed);
  const agentsCollapsed = useUI((s) => s.agentsPanelCollapsed);
  const searchOpen = useUI((s) => s.searchPanelOpen);
  const loadSettings = useSettings((s) => s.load);
  const restoreTabs = useTabs((s) => s.restoreSession);
  const saveTabsSession = useTabs((s) => s.saveSession);
  const closeAllTabs = useTabs((s) => s.closeAll);
  const workspaceHash = useWorkspace((s) => s.workspaceHash);

  const mainSplit = useDefaultLayout({
    groupId: "daisu-main-split",
    storage: typeof window !== "undefined" ? window.localStorage : memoryStorage,
  });
  const centerSplit = useDefaultLayout({
    groupId: "daisu-center-split",
    storage: typeof window !== "undefined" ? window.localStorage : memoryStorage,
  });

  useEffect(() => {
    loadSettings().catch(() => undefined);
  }, [loadSettings]);

  const rootPath = useWorkspace((s) => s.rootPath);
  useEffect(() => {
    useGit.getState().setWorkspacePath(rootPath ?? null);
    if (rootPath) void useGit.getState().refresh();
  }, [rootPath]);

  useEffect(() => {
    if (workspaceHash) {
      void restoreTabs(workspaceHash);
    } else {
      // Detach the previous workspace hash BEFORE closing tabs, otherwise
      // every closeTab → saveSession() call will overwrite the prior
      // workspace's session file with an empty-tabs blob.
      useTabs.getState()._setWorkspaceHash(null);
      void closeAllTabs(true);
    }
  }, [workspaceHash, restoreTabs, closeAllTabs]);

  useEffect(() => {
    let unlistenBeforeClose: (() => void) | null = null;
    void listen<void>("system:before-close", () => {
      void saveTabsSession();
    }).then((fn) => {
      unlistenBeforeClose = fn;
    });
    return () => {
      if (unlistenBeforeClose) unlistenBeforeClose();
    };
  }, [saveTabsSession]);

  useEffect(() => {
    if (!workspaceHash) return;
    const interval = window.setInterval(() => {
      const dirty = useTabs
        .getState()
        .tabs.some((t) => t.content !== t.savedContent);
      if (dirty) {
        void saveTabsSession();
      }
    }, 5000);
    const onBlur = (): void => {
      void saveTabsSession();
    };
    window.addEventListener("blur", onBlur);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("blur", onBlur);
    };
  }, [workspaceHash, saveTabsSession]);

  const hydrate = useWorkspace((s) => s.hydrate);
  const applyBatch = useWorkspace((s) => s.applyBatch);
  const applyFsChange = useWorkspace((s) => s.applyFsChange);
  const openWorkspace = useWorkspace((s) => s.openWorkspace);
  const pushToast = useUI((s) => s.pushToast);

  useEffect(() => {
    hydrate().catch(() => undefined);

    const unlistenPromises: Promise<() => void>[] = [];

    unlistenPromises.push(
      listen<{
        batch_id: string;
        parent_path: string | null;
        nodes: Array<{
          path: string;
          name: string;
          kind: "file" | "dir";
          size: number | null;
          mtimeMs: number | null;
        }>;
        done: boolean;
        error: string | null;
      }>("workspace:tree-batch", (event) => {
        applyBatch({
          batchId: event.payload.batch_id,
          parentPath: event.payload.parent_path,
          nodes: event.payload.nodes,
          done: event.payload.done,
        });
      })
    );

    unlistenPromises.push(
      listen<{ paths: string[] }>("workspace:fs-changed", (event) => {
        void applyFsChange(event.payload.paths);
      })
    );

    unlistenPromises.push(
      listen<void>("workspace:git-index", () => {
        // Phase 5 wires gitStore.refresh() here.
      })
    );

    unlistenPromises.push(
      listen<string>("system:dropped-path", async (event) => {
        const path = event.payload;
        try {
          await openWorkspace(path);
        } catch {
          pushToast({ message: copy.toasts.droppedNonDir, level: "warning" });
        }
      })
    );

    return () => {
      for (const p of unlistenPromises) {
        p.then((fn) => fn()).catch(() => undefined);
      }
    };
  }, [hydrate, applyBatch, applyFsChange, openWorkspace, pushToast]);

  return (
    <main className="daisu-shell">
      <TitleBar />
      <Toolbar />
      <Group
        orientation="horizontal"
        className="daisu-main-split"
        id="daisu-main-split"
        defaultLayout={mainSplit.defaultLayout}
        onLayoutChange={mainSplit.onLayoutChange}
      >
        {!sidebarCollapsed && (
          <>
            <Panel id="sidebar" defaultSize="19%" minSize="10%" maxSize="45%">
              <Sidebar />
            </Panel>
            <Separator className="daisu-resize-handle" />
          </>
        )}
        <Panel id="center" minSize="30%">
          <Group
            orientation="vertical"
            id="daisu-center-split"
            defaultLayout={centerSplit.defaultLayout}
            onLayoutChange={centerSplit.onLayoutChange}
          >
            <Panel id="editor" defaultSize={searchOpen ? "70%" : "100%"} minSize="20%">
              <EditorArea />
            </Panel>
            {searchOpen && (
              <>
                <Separator className="daisu-resize-handle daisu-resize-handle-horizontal" />
                <Panel id="search" defaultSize="30%" minSize="15%">
                  <SearchPanel />
                </Panel>
              </>
            )}
          </Group>
        </Panel>
        {!agentsCollapsed && (
          <>
            <Separator className="daisu-resize-handle" />
            <Panel id="agents" defaultSize="25%" minSize="15%" maxSize="50%">
              <AgentsPanel />
            </Panel>
          </>
        )}
      </Group>
      <StatusBar />
      <ToastViewport />
      <CloseConfirmModalConnected />
      <SettingsModal />
    </main>
  );
}

function CloseConfirmModalConnected(): JSX.Element | null {
  const pending = useTabs((s) => s.pendingClose);
  const tabs = useTabs((s) => s.tabs);
  const resolve = useTabs((s) => s.resolvePendingClose);
  const tabsByName = new Map(tabs.map((t) => [t.id, t.name]));
  return (
    <CloseConfirmModal
      pending={pending}
      tabsByName={tabsByName}
      onResolve={(action) => void resolve(action)}
    />
  );
}

// In-memory storage fallback for non-browser environments (SSR / tests).
const memoryStorage: Pick<Storage, "getItem" | "setItem"> = (() => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
})();
