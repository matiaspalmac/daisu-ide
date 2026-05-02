import type { JSX } from "react";
import { useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useWorkspace } from "../../stores/workspaceStore";
import { useUI } from "../../stores/uiStore";
import { FileTree } from "../sidebar/FileTree";
import { EmptyState } from "../sidebar/EmptyState";
import { RecentsDropdown } from "../sidebar/RecentsDropdown";
import { TreeContextMenu, type TreeAction } from "../sidebar/ContextMenu";
import { copy } from "../../lib/copy";
import { translateError } from "../../lib/error-translate";

export function Sidebar(): JSX.Element {
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

  return (
    <aside className="daisu-sidebar" aria-label="Workspace explorer">
      <div className="daisu-sidebar-header">
        <span>{copy.sidebar.explorerHeading.toUpperCase()}</span>
        <RecentsDropdown
          recents={recents}
          onOpenFolderPicker={handleOpenFolder}
          onPickRecent={handlePickRecent}
          onClearRecents={handleClearRecents}
        />
      </div>
      <div className="daisu-sidebar-body">
        <TreeContextMenu
          target={selection.size > 0 ? "node" : "empty-area"}
          selectionSize={selection.size}
          clipboardPresent={clipboard !== null}
          onAction={handleAction}
        >
          <div className="daisu-sidebar-treezone">
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
    </aside>
  );
}
