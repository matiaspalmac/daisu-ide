import type * as monacoNs from "monaco-editor";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTabs } from "../stores/tabsStore";
import { useUI } from "../stores/uiStore";
import { useWorkspace } from "../stores/workspaceStore";
import { usePalette } from "../stores/paletteStore";
import { getActiveEditor } from "./monaco-editor-ref";

export interface ActionContext {
  tabs: ReturnType<typeof useTabs.getState>;
  ui: ReturnType<typeof useUI.getState>;
  workspace: ReturnType<typeof useWorkspace.getState>;
  editor: monacoNs.editor.IStandaloneCodeEditor | null;
}

export function getActionContext(): ActionContext {
  return {
    tabs: useTabs.getState(),
    ui: useUI.getState(),
    workspace: useWorkspace.getState(),
    editor: getActiveEditor(),
  };
}

async function dispatchOpenFile(ctx: ActionContext): Promise<void> {
  try {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: "Open file",
    });
    if (typeof selected === "string") {
      await ctx.tabs.openTab(selected);
    }
  } catch {
    // toolbar / toast already report errors elsewhere
  }
}

async function dispatchOpenFolder(ctx: ActionContext): Promise<void> {
  try {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await ctx.workspace.openWorkspace(selected);
    }
  } catch {
    // ignore
  }
}

const numericGoto: Record<string, (ctx: ActionContext) => void> = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [
    `tabs.goto${i + 1}`,
    (ctx: ActionContext) => ctx.tabs.setActiveByIndex(i),
  ]),
);

export const ACTION_HANDLERS: Record<string, (ctx: ActionContext) => void> = {
  "file.new": (ctx) => ctx.tabs.newTab(),
  "file.open": (ctx) => void dispatchOpenFile(ctx),
  "file.openFolder": (ctx) => void dispatchOpenFolder(ctx),
  "file.save": (ctx) => void ctx.tabs.saveActive(),
  "file.saveAs": (ctx) => void ctx.tabs.saveActiveAs(),
  "file.saveAll": (ctx) => void ctx.tabs.saveAll(),
  "tabs.close": (ctx) => void ctx.tabs.closeActive(),
  "tabs.closeOthers": (ctx) => {
    const id = ctx.tabs.activeTabId;
    if (id) void ctx.tabs.closeOthers(id);
  },
  "tabs.closeAll": (ctx) => void ctx.tabs.closeAll(),
  "tabs.reopenClosed": (ctx) => void ctx.tabs.reopenClosed(),
  "tabs.next": (ctx) => ctx.tabs.cycleTabs(1),
  "tabs.prev": (ctx) => ctx.tabs.cycleTabs(-1),
  ...numericGoto,
  "tabs.pinToggle": (ctx) => {
    const id = ctx.tabs.activeTabId;
    if (!id) return;
    const tab = ctx.tabs.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.pinned) ctx.tabs.unpin(id);
    else ctx.tabs.pin(id);
  },
  "view.toggleSidebar": (ctx) => ctx.ui.toggleSidebar(),
  "view.toggleAgents": (ctx) => ctx.ui.toggleAgentsPanel(),
  "view.toggleSearch": (ctx) => ctx.ui.toggleSearchPanel(),
  "view.toggleFocusMode": (ctx) => ctx.ui.toggleFocusMode(),
  "settings.open": (ctx) => ctx.ui.openSettings(),
  "editor.formatDocument": (ctx) => {
    ctx.editor?.trigger("kb", "editor.action.formatDocument", {});
  },
  "workspace.close": (ctx) => {
    void ctx.workspace.closeWorkspace();
  },
  "palette.openFiles": () => usePalette.getState().togglePalette("files"),
  "palette.openCommands": () => usePalette.getState().togglePalette("commands"),
};

export function runAction(id: string): void {
  const handler = ACTION_HANDLERS[id];
  if (!handler) return;
  handler(getActionContext());
}
