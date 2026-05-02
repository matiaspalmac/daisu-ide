// Centralized UI strings. Phase 2 ships English only.
// M3+ i18n swaps this file for a translation lookup; component code stays unchanged.

export const copy = {
  sidebar: {
    explorerHeading: "Explorer",
    noFolderTitle: "No folder open",
    noFolderBody: "Open a folder to start coding.",
    walkingLabel: "Reading folder…",
    emptyFolderTitle: "This folder is empty.",
    readErrorTitle: "Couldn't read folder",
  },
  buttons: {
    openFolder: "Open Folder",
    recent: "Recent",
    newFile: "New File",
    newFolder: "New Folder",
    retry: "Retry",
    openDifferent: "Open Different Folder",
    cancel: "Cancel",
  },
  contextMenu: {
    newFile: "New File",
    newFolder: "New Folder",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    rename: "Rename",
    delete: "Delete",
    copyPath: "Copy Path",
    copyRelativePath: "Copy Relative Path",
    revealInExplorer: "Reveal in File Explorer",
  },
  toasts: {
    movedToTrash: (n: number) =>
      n === 1 ? "Moved 1 item to trash" : `Moved ${n} items to trash`,
    undo: "Undo",
    restored: (n: number, total: number) =>
      n === total ? "Restored from trash" : `Restored ${n} of ${total} items`,
    droppedNonDir: "Drop a folder to open it.",
  },
  recents: {
    openFolderItem: "Open Folder…",
    clear: "Clear Recents",
    none: "No recent workspaces",
  },
} as const;
