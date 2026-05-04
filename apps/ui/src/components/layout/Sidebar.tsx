import type { JSX } from "react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowsInLineVertical,
  CaretDown,
  CaretRight,
  FilePlus,
  FolderPlus,
  MagnifyingGlass,
  PushPin,
  PushPinSlash,
  ArrowClockwise,
  X,
} from "@phosphor-icons/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { useUI } from "../../stores/uiStore";
import { useTabs } from "../../stores/tabsStore";
import { FileTree } from "../sidebar/FileTree";
import { EmptyState } from "../sidebar/EmptyState";
import { RecentsDropdown } from "../sidebar/RecentsDropdown";
import { TreeContextMenu, type TreeAction } from "../sidebar/ContextMenu";
import { SearchInput } from "../search/SearchInput";
import { ReplaceInput } from "../search/ReplaceInput";
import { GlobFilters } from "../search/GlobFilters";
import { ResultsList } from "../search/ResultsList";
import { copy } from "../../lib/copy";
import { translateError } from "../../lib/error-translate";

export function Sidebar(): JSX.Element {
  const { t } = useTranslation();
  const rootPath = useWorkspace((s) => s.rootPath);
  const childrenIndex = useWorkspace((s) => s.childrenIndex);
  const walkDone = useWorkspace((s) => s.walkDone);
  const walkError = useWorkspace((s) => s.walkError);
  const recents = useWorkspace((s) => s.recents);
  const selection = useWorkspace((s) => s.selection);
  const clipboard = useWorkspace((s) => s.clipboard);
  const openWorkspace = useWorkspace((s) => s.openWorkspace);
  const createFile = useWorkspace((s) => s.createFile);
  const createDir = useWorkspace((s) => s.createDir);
  const deleteToTrash = useWorkspace((s) => s.deleteToTrash);
  const cut = useWorkspace((s) => s.cut);
  const copyAction = useWorkspace((s) => s.copy);
  const pasteInto = useWorkspace((s) => s.pasteInto);
  const pushToast = useUI((s) => s.pushToast);
  const sidebarFilter = useUI((s) => s.sidebarFilter);
  const setSidebarFilter = useUI((s) => s.setSidebarFilter);
  const sidebarMode = useUI((s) => s.sidebarMode);
  const setSidebarMode = useUI((s) => s.setSidebarMode);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const pinned = useWorkspace((s) => s.pinned);
  const togglePin = useWorkspace((s) => s.togglePin);
  const openTab = useTabs((s) => s.openTab);
  const tree = useWorkspace((s) => s.tree);

  const pinnedList = useMemo(
    () =>
      [...pinned].map((p) => ({ path: p, name: tree.get(p)?.name ?? p.split(/[\\/]/).pop() ?? p })),
    [pinned, tree],
  );

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await openWorkspace(selected);
      }
    } catch (e) {
      pushToast({ message: translateError(e), level: "error" });
    }
  }, [openWorkspace, pushToast]);

  const handlePickRecent = useCallback(
    async (path: string) => {
      try {
        await openWorkspace(path);
      } catch (e) {
        pushToast({ message: translateError(e), level: "error" });
      }
    },
    [openWorkspace, pushToast]
  );

  const handleClearRecents = useCallback(() => {
    useWorkspace.setState({ recents: [] });
  }, []);

  const handleAction = useCallback(
    async (action: TreeAction) => {
      const targetParent = rootPath ?? "";
      try {
        switch (action) {
          case "newFile":
            await createFile(targetParent, "untitled.txt");
            break;
          case "newFolder":
            await createDir(targetParent, "new-folder");
            break;
          case "cut":
            cut([...selection]);
            break;
          case "copy":
            copyAction([...selection]);
            break;
          case "paste":
            await pasteInto(targetParent);
            break;
          case "delete": {
            const refs = await deleteToTrash([...selection]);
            pushToast({
              message: copy.toasts.movedToTrash(refs.length),
              level: "info",
              action: { label: copy.toasts.undo, onAction: () => undefined },
            });
            break;
          }
          case "rename":
            // F2 inside <FileTree> is the canonical entry; context-menu
            // rename is wired in a future polish pass.
            break;
          case "copyPath":
            if (selection.size === 1) {
              const path = [...selection][0]!;
              await navigator.clipboard.writeText(path).catch(() => undefined);
            }
            break;
          case "copyRelativePath":
            if (selection.size === 1 && rootPath) {
              const path = [...selection][0]!;
              const rel = path.startsWith(rootPath)
                ? path.slice(rootPath.length).replace(/^[\\/]/, "")
                : path;
              await navigator.clipboard.writeText(rel).catch(() => undefined);
            }
            break;
          case "revealInExplorer":
            pushToast({
              message: "Reveal in Explorer arrives in Phase 4.",
              level: "info",
            });
            break;
          case "togglePin":
            if (selection.size === 1) togglePin([...selection][0]!);
            break;
        }
      } catch (e) {
        pushToast({ message: translateError(e), level: "error" });
      }
    },
    [
      rootPath,
      selection,
      createFile,
      createDir,
      cut,
      copyAction,
      pasteInto,
      deleteToTrash,
      pushToast,
      togglePin,
    ]
  );

  const empty = !rootPath
    ? "no-folder"
    : walkError
      ? "read-error"
      : !walkDone && (childrenIndex.get(rootPath ?? "") ?? []).length === 0
        ? "walking"
        : walkDone && (childrenIndex.get(rootPath ?? "") ?? []).length === 0
          ? "empty-folder"
          : null;

  const headerBtnCls =
    "w-7 h-7 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--warn)] hover:bg-[var(--warn-soft)] rounded-[var(--radius-sm)] transition-colors disabled:opacity-40 disabled:hover:text-[var(--fg-muted)] disabled:hover:bg-transparent disabled:cursor-not-allowed";

  const handleRefresh = useCallback((): void => {
    if (!rootPath) return;
    void handlePickRecent(rootPath);
  }, [rootPath, handlePickRecent]);

  const handleCollapseAll = useCallback((): void => {
    pushToast({
      message: t("sidebar.collapseAllToast"),
      level: "info",
    });
  }, [pushToast, t]);

  return (
    <aside
      className="daisu-sidebar relative h-full flex flex-col min-w-0 bg-[var(--bg-panel)]"
      aria-label={t("sidebar.explorerAria")}
    >
      <div className="daisu-sidebar-header">
        <div className="daisu-sidebar-title">
          <span className="daisu-glyph" aria-hidden="true">
            {sidebarMode === "search" ? "検" : "木"}
          </span>
          <span className="daisu-sidebar-title-text">
            {sidebarMode === "search" ? "SEARCH" : copy.sidebar.explorerHeading.toUpperCase()}
          </span>
        </div>
        {sidebarMode === "search" ? null : (
          <div className="daisu-sidebar-actions">
            <button
              type="button"
              title={t("sidebar.newFile")}
              aria-label={t("sidebar.newFile")}
              onClick={() => void handleAction("newFile")}
              disabled={!rootPath}
              className={headerBtnCls}
            >
              <FilePlus size={13} />
            </button>
            <button
              type="button"
              title={t("sidebar.newFolder")}
              aria-label={t("sidebar.newFolder")}
              onClick={() => void handleAction("newFolder")}
              disabled={!rootPath}
              className={headerBtnCls}
            >
              <FolderPlus size={13} />
            </button>
            <button
              type="button"
              title={t("sidebar.searchProject")}
              aria-label={t("sidebar.search")}
              onClick={() => setSidebarMode("search")}
              disabled={!rootPath}
              className={headerBtnCls}
            >
              <MagnifyingGlass size={13} />
            </button>
            <button
              type="button"
              title={t("sidebar.refresh")}
              aria-label={t("sidebar.refresh")}
              onClick={handleRefresh}
              disabled={!rootPath}
              className={headerBtnCls}
            >
              <ArrowClockwise size={13} />
            </button>
            <button
              type="button"
              title={t("sidebar.collapseAll")}
              aria-label={t("sidebar.collapseAll")}
              onClick={handleCollapseAll}
              className={headerBtnCls}
            >
              <ArrowsInLineVertical size={13} />
            </button>
            <RecentsDropdown
              recents={recents}
              onOpenFolderPicker={handleOpenFolder}
              onPickRecent={handlePickRecent}
              onClearRecents={handleClearRecents}
            />
          </div>
        )}
      </div>
      {sidebarMode === "files" && rootPath && (
        <div className="daisu-sidebar-filter">
          <span className="daisu-glyph" aria-hidden="true">検</span>
          <input
            type="text"
            placeholder={t("sidebar.filterPlaceholder")}
            value={sidebarFilter}
            onChange={(e) => setSidebarFilter(e.target.value)}
            aria-label={t("sidebar.filterAria")}
          />
          {sidebarFilter && (
            <button
              type="button"
              className="daisu-sidebar-filter-clear"
              onClick={() => setSidebarFilter("")}
              aria-label={t("sidebar.clearFilter")}
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}
      {sidebarMode === "files" && pinnedList.length > 0 && (
        <div className="daisu-pinned">
          <div className="daisu-pinned-header">
            <span className="daisu-glyph" aria-hidden="true">印</span>
            {t("sidebar.pinned")}
          </div>
          <ul className="daisu-pinned-list">
            {pinnedList.map((p) => (
              <li key={p.path} className="daisu-pinned-row">
                <button
                  type="button"
                  className="daisu-pinned-item"
                  onClick={() => void openTab(p.path)}
                  title={p.path}
                >
                  <PushPin size={11} />
                  <span className="daisu-pinned-name">{p.name}</span>
                </button>
                <button
                  type="button"
                  className="daisu-pinned-unpin"
                  onClick={() => togglePin(p.path)}
                  aria-label={t("sidebar.unpinName", { name: p.name })}
                  title={t("sidebar.unpin")}
                >
                  <PushPinSlash size={11} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {sidebarMode === "search" && (
        <div className="daisu-sidebar-body flex-1 min-h-0 daisu-sidebar-search">
          <div className="daisu-search-inputs">
            <button
              type="button"
              className="daisu-search-expand"
              onClick={() => setSearchExpanded((v) => !v)}
              aria-expanded={searchExpanded}
              aria-label={searchExpanded ? t("sidebar.collapseFilters") : t("sidebar.expandFilters")}
              title={searchExpanded ? t("sidebar.hideFilters") : t("sidebar.showFilters")}
            >
              {searchExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
            </button>
            <div className="daisu-search-inputs-stack">
              <SearchInput />
              {searchExpanded && (
                <>
                  <ReplaceInput />
                  <GlobFilters />
                </>
              )}
            </div>
          </div>
          <ResultsList />
        </div>
      )}
      {sidebarMode === "files" && (
      <div className="daisu-sidebar-body flex-1 min-h-0">
        <TreeContextMenu
          target={selection.size > 0 ? "node" : "empty-area"}
          selectionSize={selection.size}
          clipboardPresent={clipboard !== null}
          onAction={handleAction}
        >
          <div className="daisu-sidebar-treezone h-full">
            {empty === "no-folder" && (
              <EmptyState variant="no-folder" onOpenFolder={handleOpenFolder} />
            )}
            {empty === "walking" && <EmptyState variant="walking" />}
            {empty === "empty-folder" && (
              <EmptyState
                variant="empty-folder"
                onNewFile={() => handleAction("newFile")}
                onNewFolder={() => handleAction("newFolder")}
              />
            )}
            {empty === "read-error" && (
              <EmptyState
                variant="read-error"
                message={walkError ?? undefined}
                onRetry={() => rootPath && handlePickRecent(rootPath)}
                onOpenDifferent={handleOpenFolder}
              />
            )}
            {empty === null && <FileTree />}
          </div>
        </TreeContextMenu>
      </div>
      )}
    </aside>
  );
}
