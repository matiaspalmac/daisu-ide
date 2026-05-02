import type { JSX } from "react";
import { useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useUI } from "../../stores/uiStore";
import { useTabs } from "../../stores/tabsStore";
import { useWorkspace } from "../../stores/workspaceStore";
import { Icon } from "../ui/Icon";
import {
  openFileViaDialog,
  saveFile,
  saveFileAsViaDialog,
} from "../../api/tauri";
import { translateError } from "../../lib/error-translate";

export function Toolbar(): JSX.Element {
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const toggleAgents = useUI((s) => s.toggleAgentsPanel);
  const toggleSearch = useUI((s) => s.toggleSearchPanel);
  const openSettings = useUI((s) => s.openSettings);
  const pushToast = useUI((s) => s.pushToast);

  const handleOpen = useCallback(async (): Promise<void> => {
    try {
      const opened = await openFileViaDialog();
      if (opened === null) return;
      const tabs = useTabs.getState();
      tabs.addTab({
        path: opened.path,
        name: opened.path.split(/[\\/]/).pop() ?? opened.path,
        language: opened.language,
        content: opened.contents,
      });
    } catch (err) {
      pushToast({
        message: err instanceof Error ? err.message : String(err),
        level: "error",
      });
    }
  }, [pushToast]);

  const openWorkspace = useWorkspace((s) => s.openWorkspace);
  const handleOpenFolder = useCallback(async (): Promise<void> => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await openWorkspace(selected);
      }
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  }, [openWorkspace, pushToast]);

  const handleSave = useCallback(async (): Promise<void> => {
    const tabs = useTabs.getState();
    const tab = tabs.activeTab();
    if (!tab) return;
    try {
      let path = tab.path;
      if (path === null) {
        const saved = await saveFileAsViaDialog(tab.content);
        if (saved === null) return;
        path = saved;
      } else {
        await saveFile(path, tab.content);
      }
      tabs.markSaved(tab.id);
      pushToast({ message: `Saved ${path}`, level: "success" });
    } catch (err) {
      pushToast({
        message: err instanceof Error ? err.message : String(err),
        level: "error",
      });
    }
  }, [pushToast]);

  return (
    <header className="daisu-toolbar" role="toolbar">
      <button
        type="button"
        className="daisu-icon-btn"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
      >
        <Icon name="panelLeft" />
      </button>
      <h1>Daisu IDE</h1>
      <button type="button" onClick={handleOpen} className="daisu-btn">Open…</button>
      <button type="button" onClick={handleOpenFolder} className="daisu-btn">Open Folder…</button>
      <button type="button" onClick={handleSave} className="daisu-btn">Save</button>
      <span className="daisu-toolbar-spacer" />
      <button
        type="button"
        className="daisu-icon-btn"
        onClick={toggleSearch}
        aria-label="Toggle search panel"
      >
        <Icon name="search" />
      </button>
      <button
        type="button"
        className="daisu-icon-btn"
        onClick={() => openSettings()}
        aria-label="Open settings"
      >
        <Icon name="settings" />
      </button>
      <button
        type="button"
        className="daisu-icon-btn"
        onClick={toggleAgents}
        aria-label="Toggle agents panel"
      >
        <Icon name="bot" />
      </button>
    </header>
  );
}
