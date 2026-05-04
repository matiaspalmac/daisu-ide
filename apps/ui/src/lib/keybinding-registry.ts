export const ACTION_CATEGORIES = [
  "File",
  "Tabs",
  "Editor",
  "View",
  "Settings",
  "Workspace",
  "Palette",
  "Agente",
] as const;

export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export interface ActionDef {
  id: string;
  category: ActionCategory;
  label: string;
  /** tinykeys format. `$mod` resolves to Ctrl on Windows. */
  defaultBinding: string;
}

const gotoTabs: ActionDef[] = Array.from({ length: 9 }, (_, i) => ({
  id: `tabs.goto${i + 1}`,
  category: "Tabs",
  label: `Go to tab ${i + 1}`,
  defaultBinding: `$mod+${i + 1}`,
}));

export const ACTIONS: ActionDef[] = [
  // File
  { id: "file.new", category: "File", label: "New untitled tab", defaultBinding: "$mod+n" },
  { id: "file.open", category: "File", label: "Open file…", defaultBinding: "$mod+o" },
  { id: "file.openFolder", category: "File", label: "Open folder…", defaultBinding: "$mod+Shift+o" },
  { id: "file.save", category: "File", label: "Save", defaultBinding: "$mod+s" },
  { id: "file.saveAs", category: "File", label: "Save as…", defaultBinding: "$mod+Shift+s" },
  { id: "file.saveAll", category: "File", label: "Save all", defaultBinding: "$mod+Alt+s" },

  // Tabs
  { id: "tabs.close", category: "Tabs", label: "Close tab", defaultBinding: "$mod+w" },
  { id: "tabs.closeOthers", category: "Tabs", label: "Close other tabs", defaultBinding: "$mod+Alt+t" },
  { id: "tabs.closeAll", category: "Tabs", label: "Close all tabs", defaultBinding: "$mod+Shift+w" },
  { id: "tabs.reopenClosed", category: "Tabs", label: "Reopen closed tab", defaultBinding: "$mod+Shift+t" },
  { id: "tabs.next", category: "Tabs", label: "Next tab (MRU)", defaultBinding: "$mod+Tab" },
  { id: "tabs.prev", category: "Tabs", label: "Previous tab (MRU)", defaultBinding: "$mod+Shift+Tab" },
  ...gotoTabs,
  { id: "tabs.pinToggle", category: "Tabs", label: "Pin/unpin active tab", defaultBinding: "$mod+Alt+p" },

  // View
  { id: "view.toggleSidebar", category: "View", label: "Toggle sidebar", defaultBinding: "$mod+b" },
  { id: "view.toggleAgents", category: "View", label: "Toggle agents panel", defaultBinding: "$mod+j" },
  { id: "view.toggleSearch", category: "View", label: "Toggle search panel", defaultBinding: "$mod+Shift+f" },
  { id: "view.toggleFocusMode", category: "View", label: "Toggle focus mode (静)", defaultBinding: "$mod+\\" },

  // Settings
  { id: "settings.open", category: "Settings", label: "Open settings", defaultBinding: "$mod+," },

  // Editor
  { id: "editor.formatDocument", category: "Editor", label: "Format document", defaultBinding: "Shift+Alt+f" },

  // Workspace
  { id: "workspace.close", category: "Workspace", label: "Close workspace", defaultBinding: "$mod+Shift+k" },

  // Palette
  { id: "palette.openFiles", category: "Palette", label: "Quick open file (索)", defaultBinding: "$mod+p" },
  { id: "palette.openCommands", category: "Palette", label: "Show all commands (命)", defaultBinding: "$mod+Shift+p" },
  { id: "palette.openSymbols", category: "Palette", label: "Search workspace symbols (号)", defaultBinding: "$mod+t" },

  // Agente — slash commands. Surface them in the regular commands palette
  // too so users can discover them without typing the slash prefix.
  { id: "agent.slash.explain", category: "Agente", label: "/explain — Explain selection", defaultBinding: "" },
  { id: "agent.slash.fix", category: "Agente", label: "/fix — Fix this code", defaultBinding: "" },
  { id: "agent.slash.test", category: "Agente", label: "/test — Generate test for selection", defaultBinding: "" },
  { id: "agent.slash.refactor", category: "Agente", label: "/refactor — Refactor selection", defaultBinding: "" },
];
