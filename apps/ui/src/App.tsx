import type { JSX } from "react";
import { Suspense, lazy, useEffect } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { listen } from "@tauri-apps/api/event";
import { IconContext } from "@phosphor-icons/react";
import { TitleBar } from "./components/layout/TitleBar";
import { WebView2Banner } from "./components/layout/WebView2Banner";
import { ResizeHandles } from "./components/layout/ResizeHandles";
import { ActivityBar } from "./components/layout/ActivityBar";
import { Sidebar } from "./components/layout/Sidebar";
import { EditorArea } from "./components/layout/EditorArea";
import { RightPanel } from "./components/layout/RightPanel";
import { StatusBar } from "./components/layout/StatusBar";
import { useBottomPanel } from "./stores/bottomPanelStore";

// xterm.js + 4 addons live behind BottomPanel (~85 kB gzipped). Lazy-load
// keeps the main bundle under the size-limit budget; the panel only renders
// when the user explicitly toggles it (Ctrl+`, Problems/Output, etc.).
const BottomPanel = lazy(() =>
  import("./components/bottompanel/BottomPanel").then((m) => ({
    default: m.BottomPanel,
  })),
);
import { useSearchListeners } from "./hooks/useSearchListeners";
import { useDiscordRpc } from "./hooks/useDiscordRpc";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { ToastViewport } from "./components/ui/Toast";
import { CloseConfirmModal } from "./components/tabs/CloseConfirmModal";

// Heavy overlays / modals that aren't on the first-paint path. Each
// pulls in Radix Dialog/Popover, Phosphor icon subsets, fuzzysort,
// or LSP/agent state that the user may never touch in a session.
// Code-splitting them shrinks the initial JS chunk and the runtime
// memory footprint of the welcome screen.
const SettingsModal = lazy(() =>
  import("./components/settings/SettingsModal").then((m) => ({ default: m.SettingsModal })),
);
const CommandPalette = lazy(() =>
  import("./components/palette/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const SymbolSearchPalette = lazy(() =>
  import("./components/agent/SymbolSearchPalette").then((m) => ({ default: m.SymbolSearchPalette })),
);
const LspWorkspaceSymbolPalette = lazy(() =>
  import("./components/palette/LspWorkspaceSymbolPalette").then((m) => ({
    default: m.LspWorkspaceSymbolPalette,
  })),
);
const FileSymbolPalette = lazy(() =>
  import("./components/palette/FileSymbolPalette").then((m) => ({ default: m.FileSymbolPalette })),
);
const PermissionModal = lazy(() =>
  import("./components/agent/PermissionModal").then((m) => ({ default: m.PermissionModal })),
);
const InlineEditOverlay = lazy(() =>
  import("./components/agent/InlineEditOverlay").then((m) => ({ default: m.InlineEditOverlay })),
);
import { useUI } from "./stores/uiStore";
import { useSettings } from "./stores/settingsStore";
import { useWorkspace } from "./stores/workspaceStore";
import { useTabs, persistDirtyUntitledScratch } from "./stores/tabsStore";
import { startDiagnosticsListener } from "./stores/diagnosticsStore";
import { startWorkspaceOpenedListener } from "./lsp/monacoBridge";
import { useKeybindings } from "./hooks/useKeybindings";
import { useTheme } from "./hooks/useTheme";
import { useGitWatcher } from "./hooks/useGitWatcher";
import { useEditorCursorWiring } from "./hooks/useEditorCursor";
import { useGit } from "./stores/gitStore";
import { isTauri } from "./lib/tauri-env";
import i18n, { setLanguage, type AppLanguage } from "./i18n";
import { probeOllama, pickBestModel } from "./lib/ollama-detect";
import { isTauri as checkTauri } from "./lib/tauri-env";

// react-resizable-panels v4 uses percentage-string sizing on each Panel
// `defaultSize` prop. Layout persistence (useDefaultLayout) was dropped
// in P1 hotfix due to v4 layout-data assertion crashes on fresh storage;
// re-introduce after upstream fix (or migrate persistence) in P6+.

export function App(): JSX.Element {
  useKeybindings();
  useTheme();
  useGitWatcher();
  useEditorCursorWiring();
  useSearchListeners();
  useDiscordRpc();
  useAutoUpdate();
  const sidebarCollapsed = useUI((s) => s.sidebarCollapsed);
  const agentsCollapsed = useUI((s) => s.agentsPanelCollapsed);
  const focusMode = useUI((s) => s.focusMode);
  const bottomPanelOpen = useBottomPanel((s) => s.open);


  useEffect(() => {
    document.body.classList.toggle("daisu-focus-mode", focusMode);
  }, [focusMode]);
  const loadSettings = useSettings((s) => s.load);
  const design = useSettings((s) => s.settings.design);
  const layoutMode = design.layoutMode;
  useEffect(() => {
    const isFleet = layoutMode === "fleet";
    document.body.classList.toggle("daisu-layout-fleet", isFleet);
    return () => {
      document.body.classList.remove("daisu-layout-fleet");
    };
  }, [layoutMode]);
  const restoreTabs = useTabs((s) => s.restoreSession);
  const saveTabsSession = useTabs((s) => s.saveSession);
  const closeAllTabs = useTabs((s) => s.closeAll);
  const workspaceHash = useWorkspace((s) => s.workspaceHash);

  useEffect(() => {
    loadSettings().catch(() => undefined);
  }, [loadSettings]);

  // LSP diagnostics arrive on the `agent://lsp-diagnostics` Tauri event;
  // Tauri does not buffer events delivered before a listener is attached.
  // Previously the subscriber lived inside <BottomPanel>, which is
  // lazy-loaded and only mounts when the user opens the panel — so any
  // diagnostics published by rust-analyzer during the cold-start window
  // were dropped, leaving Problems panel empty even though Monaco markers
  // showed errors. Hoisting the listener to App boot ensures the store
  // captures every event from the very first publish.
  useEffect(() => {
    startDiagnosticsListener();
    // Workspace-opened listener must be live BEFORE the trust dialog or a
    // workspace re-open from a restored session can fire the event,
    // otherwise tracked models that opened against an untrusted backend
    // never get retracked and the user has to manually close + reopen
    // each restored tab to trigger LSP analysis.
    void startWorkspaceOpenedListener();
  }, []);

  const language = useSettings((s) => s.settings.general.language);
  const languageInitialized = useSettings((s) => s.settings.general.languageInitialized);
  const setSetting = useSettings((s) => s.set);
  const settingsLoaded = useSettings((s) => s.loaded);
  useEffect(() => {
    setLanguage(language);
  }, [language]);

  // First-launch OS locale detection. Runs once per profile (gated by
  // `languageInitialized` flag); afterwards the user's choice in Settings →
  // General wins. Falls back to "en" on non-Tauri builds or unknown locales.
  useEffect(() => {
    if (!settingsLoaded) return;
    if (languageInitialized) return;
    if (!checkTauri()) {
      void setSetting("general", { languageInitialized: true });
      return;
    }
    void import("@tauri-apps/plugin-os").then(async ({ locale }) => {
      const sys = (await locale()) ?? "";
      const tag = sys.toLowerCase();
      const detected: AppLanguage = tag.startsWith("es")
        ? "es"
        : tag.startsWith("ja")
          ? "ja"
          : "en";
      await setSetting("general", {
        language: detected,
        languageInitialized: true,
      });
    }).catch(() => {
      void setSetting("general", { languageInitialized: true });
    });
  }, [settingsLoaded, languageInitialized, setSetting]);

  // Autodetect Ollama install on startup. If the user is on the default
  // provider and the configured model isn't actually pulled, swap to the
  // best available model so the agent works out-of-the-box.
  const aiProvider = useSettings((s) => s.settings.aiProvider);
  useEffect(() => {
    if (!settingsLoaded) return;
    if (aiProvider.id !== "ollama") return;
    let cancelled = false;
    void probeOllama(aiProvider.ollamaBaseUrl).then((probe) => {
      if (cancelled || !probe.reachable) return;
      const best = pickBestModel(probe.models, aiProvider.model);
      if (best !== aiProvider.model) {
        void setSetting("aiProvider", { model: best });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [settingsLoaded, aiProvider.id, aiProvider.ollamaBaseUrl, aiProvider.model, setSetting]);

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
      const persisted = persistDirtyUntitledScratch(useTabs.getState().tabs);
      if (persisted > 0) {
        useUI.getState().pushToast({
          message: i18n.t("welcome.scratchPersisted", { count: persisted }),
          level: "warning",
        });
      }
      useTabs.getState()._setWorkspaceHash(null);
      void closeAllTabs(true);
    }
  }, [workspaceHash, restoreTabs, closeAllTabs]);

  useEffect(() => {
    if (!isTauri()) return;
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
    if (!isTauri()) return;
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
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.log("[walker]", {
            nodes: event.payload.nodes.length,
            done: event.payload.done,
            batch_id: event.payload.batch_id,
          });
        }
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
          pushToast({ message: i18n.t("explorer.droppedNonDir"), level: "warning" });
        }
      })
    );

    return () => {
      for (const p of unlistenPromises) {
        p.then((fn) => fn()).catch(() => undefined);
      }
    };
  }, [hydrate, applyBatch, applyFsChange, openWorkspace, pushToast]);

  const showSidebar = design.sidebarVisible && !sidebarCollapsed && !focusMode;
  const showRightPanel = design.rightPanelVisible && !agentsCollapsed && !focusMode;
  const sidebarOnRight = design.sidebarSide === "right";
  const rightPanelOnLeft = design.rightPanelSide === "left";
  const activityBarOnRight = design.activityBarSide === "right";
  const activityBarVisible = design.activityBarVisible;

  const sidebarRef = usePanelRef();
  const agentsRef = usePanelRef();

  // Double-click on a resize handle auto-fits the adjacent panel to its
  // content scrollWidth (mirrors VS Code's dblclick-to-fit behaviour).
  // Falls back to the panel's defaultSize when content can't be measured.
  const fitPanel = (
    panelId: "sidebar" | "agents",
    fallbackPct: number,
  ) => (): void => {
    const ref = panelId === "sidebar" ? sidebarRef.current : agentsRef.current;
    if (!ref) return;
    const groupEl = document.getElementById("daisu-main-split");
    const panelEl = document.querySelector<HTMLElement>(
      `[data-panel-id="${panelId}"]`,
    );
    if (!groupEl || !panelEl) {
      ref.resize(`${fallbackPct}%`);
      return;
    }
    const inner =
      panelEl.querySelector<HTMLElement>(".daisu-sidebar, .daisu-agents-panel") ??
      panelEl;
    const desired = Math.max(inner.scrollWidth + 16, 200);
    const groupWidth = groupEl.clientWidth || window.innerWidth;
    const pct = Math.min(45, Math.max(12, (desired / groupWidth) * 100));
    ref.resize(`${pct}%`);
  };

  const sidebarPanel = showSidebar ? (
    <>
      <Panel panelRef={sidebarRef} id="sidebar" defaultSize="15%" minSize="10%" maxSize="40%">
        <Sidebar />
      </Panel>
      <Separator
        className="daisu-resize-handle"
        onDoubleClick={fitPanel("sidebar", 15)}
      />
    </>
  ) : null;

  const rightPanel = showRightPanel ? (
    <>
      <Separator
        className="daisu-resize-handle"
        onDoubleClick={fitPanel("agents", 25)}
      />
      <Panel panelRef={agentsRef} id="agents" defaultSize="25%" minSize="15%" maxSize="50%">
        <RightPanel />
      </Panel>
    </>
  ) : null;

  return (
    <IconContext.Provider value={{ weight: "light", size: 14 }}>
    <main className="daisu-shell flex flex-col h-screen overflow-hidden">
      <TitleBar />
      <WebView2Banner />
      <div className="flex-1 flex flex-row min-h-0 overflow-hidden">
        {activityBarVisible && !activityBarOnRight && !focusMode && <ActivityBar />}
        <Group
          orientation="horizontal"
          className="daisu-main-split flex-1"
          id="daisu-main-split"
        >
        {!sidebarOnRight && sidebarPanel}
        {rightPanelOnLeft && rightPanel}
        <Panel id="center" defaultSize="56%" minSize="30%">
          {/* The vertical Group + editor Panel are always mounted so that
              toggling BottomPanel never reparents <EditorArea/>. Reparenting
              the Monaco editor mid-session disposes its model and crashes
              syncActiveTab on the next render with `Model is disposed!`. */}
          <Group orientation="vertical" className="h-full">
            <Panel id="editor" defaultSize="70%" minSize="20%">
              <EditorArea />
            </Panel>
            {bottomPanelOpen && (
              <>
                <Separator className="daisu-resize-handle daisu-resize-handle-horizontal" />
                <Panel id="bottom" defaultSize="30%" minSize="10%" maxSize="80%">
                  <Suspense fallback={null}>
                    <BottomPanel />
                  </Suspense>
                </Panel>
              </>
            )}
          </Group>
        </Panel>
        {!rightPanelOnLeft && rightPanel}
        {sidebarOnRight && sidebarPanel}
        </Group>
        {activityBarVisible && activityBarOnRight && !focusMode && <ActivityBar />}
      </div>
      {design.statusBarVisible && !focusMode && <StatusBar />}
      <ToastViewport />
      <CloseConfirmModalConnected />
      <Suspense fallback={null}>
        <SettingsModal />
        <CommandPalette />
        <SymbolSearchPalette />
        <LspWorkspaceSymbolPalette />
        <FileSymbolPalette />
        <PermissionModal />
        <InlineEditOverlay />
      </Suspense>
      <ResizeHandles />
    </main>
    </IconContext.Provider>
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

