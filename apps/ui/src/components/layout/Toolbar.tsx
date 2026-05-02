import type { JSX } from "react";
import { useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useUI } from "../../stores/uiStore";
import { useTabs } from "../../stores/tabsStore";
import { useWorkspace } from "../../stores/workspaceStore";
import { Icon } from "../ui/Icon";
import { translateError } from "../../lib/error-translate";

export function Toolbar(): JSX.Element {
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const toggleAgents = useUI((s) => s.toggleAgentsPanel);
  const toggleSearch = useUI((s) => s.toggleSearchPanel);
  const openSettings = useUI((s) => s.openSettings);
  const pushToast = useUI((s) => s.pushToast);
  const openTab = useTabs((s) => s.openTab);
  const saveActive = useTabs((s) => s.saveActive);
  const newTab = useTabs((s) => s.newTab);
  const openWorkspace = useWorkspace((s) => s.openWorkspace);

  const handleNew = useCallback((): void => {
    newTab();
  }, [newTab]);

  const handleOpen = useCallback(async (): Promise<void> => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: "Open file",
      });
      if (typeof selected === "string") {
        await openTab(selected);
      }
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  }, [openTab, pushToast]);

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
    try {
      await saveActive();
      pushToast({ message: "Saved", level: "success" });
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  }, [saveActive, pushToast]);

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
      <button type="button" onClick={handleNew} className="daisu-btn">+ New</button>
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
