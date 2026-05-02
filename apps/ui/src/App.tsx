import type { JSX } from "react";
import { useEffect } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { TitleBar } from "./components/layout/TitleBar";
import { Toolbar } from "./components/layout/Toolbar";
import { Sidebar } from "./components/layout/Sidebar";
import { EditorArea } from "./components/layout/EditorArea";
import { AgentsPanel } from "./components/layout/AgentsPanel";
import { StatusBar } from "./components/layout/StatusBar";
import { SearchPanel } from "./components/layout/SearchPanel";
import { ToastViewport } from "./components/ui/Toast";
import { useUI } from "./stores/uiStore";
import { useSettings } from "./stores/settingsStore";

// Note: react-resizable-panels v4 uses percentage-string sizing.
// We use useDefaultLayout({ groupId, storage }) to persist sizes to
// localStorage instead of syncing to Zustand on every drag (avoids
// feedback loops). Approximate percent defaults assume a ~1280px window:
//   240/1280 ≈ 19% sidebar, 320/1280 ≈ 25% agents.

export function App(): JSX.Element {
  const sidebarCollapsed = useUI((s) => s.sidebarCollapsed);
  const agentsCollapsed = useUI((s) => s.agentsPanelCollapsed);
  const searchOpen = useUI((s) => s.searchPanelOpen);
  const loadSettings = useSettings((s) => s.load);

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
    </main>
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
