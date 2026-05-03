import { useEffect, useRef, useState, type JSX } from "react";
import { Plus } from "lucide-react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { useTabs, type OpenTab } from "../../stores/tabsStore";
import { Tab } from "./Tab";
import { TabContextMenu, type TabAction } from "./TabContextMenu";
import { TabOverflowDropdown } from "./TabOverflowDropdown";
import { useUI } from "../../stores/uiStore";

const OVERFLOW_BUDGET_PX = 64;

export function TabBar(): JSX.Element | null {
  const tabs = useTabs((s) => s.tabs);
  const activeTabId = useTabs((s) => s.activeTabId);
  const reorder = useTabs((s) => s.reorder);
  const setActive = useTabs((s) => s.setActive);
  const closeTab = useTabs((s) => s.closeTab);
  const closeOthers = useTabs((s) => s.closeOthers);
  const closeAll = useTabs((s) => s.closeAll);
  const pin = useTabs((s) => s.pin);
  const unpin = useTabs((s) => s.unpin);
  const newTab = useTabs((s) => s.newTab);
  const pushToast = useUI((s) => s.pushToast);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);

  useEffect(() => {
    return monitorForElements({
      onDrop({ source, location }) {
        const target = location.current.dropTargets[0];
        if (!target) return;
        const sourceId = source.data.tabId as string | undefined;
        const targetId = target.data.tabId as string | undefined;
        if (!sourceId || !targetId || sourceId === targetId) return;
        const edge = extractClosestEdge(target.data);
        const list = useTabs.getState().tabs;
        let toIndex = list.findIndex((t) => t.id === targetId);
        if (edge === "right") toIndex += 1;
        reorder(sourceId, toIndex);
      },
    });
  }, [reorder]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const recompute = (): void => {
      // Skip overflow math when the container has no measurable width yet
      // (initial paint, jsdom). Without this, available becomes negative and
      // every tab gets flagged as hidden.
      if (root.clientWidth === 0) {
        setHiddenIds([]);
        return;
      }
      const available = root.clientWidth - OVERFLOW_BUDGET_PX;
      const tabEls = Array.from(
        root.querySelectorAll<HTMLElement>("[data-tab-id]"),
      );
      let used = 0;
      const hidden: string[] = [];
      tabEls.forEach((el) => {
        used += el.offsetWidth;
        if (used > available) hidden.push(el.dataset["tabId"] ?? "");
      });
      setHiddenIds(hidden.filter(Boolean));
    };
    const obs = new ResizeObserver(recompute);
    obs.observe(root);
    recompute();
    return () => obs.disconnect();
    // Only re-subscribe when the SET of tabs changes, not on every keystroke
    // (each Monaco onChange clones the tabs array even though length is stable).
  }, [tabs.length]);

  const visibleTabs = tabs.filter((t) => !hiddenIds.includes(t.id));
  const hiddenTabs = tabs.filter((t) => hiddenIds.includes(t.id));

  const handleAction = async (tab: OpenTab, action: TabAction): Promise<void> => {
    switch (action) {
      case "close":
        await closeTab(tab.id);
        break;
      case "closeOthers":
        await closeOthers(tab.id);
        break;
      case "closeAll":
        await closeAll();
        break;
      case "pin":
        pin(tab.id);
        break;
      case "unpin":
        unpin(tab.id);
        break;
      case "copyPath":
        if (tab.path) {
          await navigator.clipboard.writeText(tab.path).catch(() => undefined);
        }
        break;
      case "revealInExplorer":
        pushToast({
          message: "Reveal in Explorer arrives in Phase 4.",
          level: "info",
        });
        break;
    }
  };

  return (
    <div ref={containerRef} className="daisu-tabbar" role="tablist" aria-label="Open tabs">
      {visibleTabs.map((tab) => (
        <DraggableTab
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          onActivate={() => setActive(tab.id)}
          onClose={() => void closeTab(tab.id)}
          onAction={(a) => void handleAction(tab, a)}
        />
      ))}
      <TabOverflowDropdown
        hidden={hiddenTabs.map((t) => ({
          id: t.id,
          name: t.name,
          dirty: t.content !== t.savedContent,
          pinned: t.pinned,
        }))}
        onPick={setActive}
      />
      <button
        type="button"
        onClick={() => newTab()}
        title="Nuevo archivo"
        aria-label="Nuevo archivo"
        className="w-8 h-8 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] border-l border-[var(--border-subtle)] flex-shrink-0"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

interface DraggableProps {
  tab: OpenTab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  onAction: (a: TabAction) => void;
}

function DraggableTab({
  tab,
  active,
  onActivate,
  onClose,
  onAction,
}: DraggableProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return combine(
      draggable({
        element: el,
        // Pragmatic-DnD fires on any pointerdown by default; allow only the
        // primary mouse button so right-click context menu and middle-click
        // close are not swallowed by the drag start.
        canDrag: ({ input }) => input.button === 0,
        getInitialData: () => ({ tabId: tab.id }),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => source.data["tabId"] !== tab.id,
        getData: ({ input, element }) =>
          attachClosestEdge(
            { tabId: tab.id },
            { input, element, allowedEdges: ["left", "right"] },
          ),
        onDragEnter: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    );
  }, [tab.id]);

  return (
    <TabContextMenu
      tabId={tab.id}
      pinned={tab.pinned}
      hasPath={tab.path !== null}
      totalTabs={useTabs.getState().tabs.length}
      onAction={onAction}
    >
      <div data-tab-id={tab.id}>
        <Tab
          tab={tab}
          active={active}
          onActivate={onActivate}
          onClose={onClose}
          closestEdge={closestEdge}
          dragHandleRef={(el) => {
            ref.current = el;
          }}
        />
      </div>
    </TabContextMenu>
  );
}
