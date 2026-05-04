import { create } from "zustand";
import { z } from "zod";
import { load } from "@tauri-apps/plugin-store";

const SettingsSchema = z.object({
  general: z.object({
    autoSwitchSystemTheme: z.boolean().default(true),
    confirmCloseDirty: z.boolean().default(true),
    restoreSessionOnStart: z.boolean().default(true),
    language: z.enum(["en", "es", "ja"]).default("en"),
    languageInitialized: z.boolean().default(false),
  }).prefault({}),
  editor: z.object({
    fontSize: z.number().min(8).max(48).default(13),
    fontFamily: z.string().default("Cascadia Code, Consolas, monospace"),
    tabSize: z.number().min(1).max(16).default(2),
    insertSpaces: z.boolean().default(true),
    wordWrap: z.enum(["off", "on", "wordWrapColumn", "bounded"]).default("off"),
    minimap: z.boolean().default(false),
    lineNumbers: z.enum(["on", "off", "relative"]).default("on"),
    cursorStyle: z.enum(["line", "block", "underline"]).default("line"),
    smoothScrolling: z.boolean().default(true),
    bracketPairColorization: z.boolean().default(true),
    formatOnSave: z.boolean().default(false),
    keySoundEnabled: z.boolean().default(false),
    keySoundVolume: z.number().min(0).max(1).default(0.3),
    keySoundPack: z.enum(["soft", "typewriter", "mechanical"]).default("soft"),
  }).prefault({}),
  themes: z.object({
    activeThemeId: z.string().default("tron-dark"),
    autoSwitchOnSystem: z.boolean().default(false),
    systemDarkTheme: z.string().default("tron-dark"),
    systemLightTheme: z.string().default("daisu-light"),
  }).prefault({}),
  aiProvider: z.object({
    mode: z.enum(["cloud", "local"]).default("local"),
    id: z
      .preprocess(
        (v) => (v === "claude" ? "anthropic" : v),
        z.enum(["gemini", "openai", "anthropic", "lmstudio", "ollama"]),
      )
      .default("ollama"),
    model: z.string().default("llama3.2"),
    ollamaBaseUrl: z.string().default("http://localhost:11434"),
    lmstudioBaseUrl: z.string().default("http://localhost:1234/v1"),
    temperature: z.number().min(0).max(2).default(0.7),
    apiKey: z.string().default(""),
  }).prefault({}),
  design: z.object({
    activityBarSide: z.enum(["left", "right"]).default("left"),
    activityBarVisible: z.boolean().default(false),
    statusBarVisible: z.boolean().default(true),
    sidebarSide: z.enum(["left", "right"]).default("left"),
    sidebarVisible: z.boolean().default(true),
    rightPanelSide: z.enum(["right", "left"]).default("right"),
    rightPanelVisible: z.boolean().default(true),
    terminalVisible: z.boolean().default(false),
    statusBarPanelToggles: z.boolean().default(true),
    statusBarUtility: z.boolean().default(true),
    titleBarHamburger: z.boolean().default(true),
    titleBarMenuStrip: z.boolean().default(true),
    titleBarUserAvatar: z.boolean().default(true),
    layoutMode: z.enum(["classic", "fleet"]).default("classic"),
    classicSnapshot: z
      .object({
        sidebarSide: z.enum(["left", "right"]),
        rightPanelSide: z.enum(["left", "right"]),
        activityBarVisible: z.boolean(),
        sidebarVisible: z.boolean(),
        rightPanelVisible: z.boolean(),
      })
      .optional(),
  }).prefault({}),
  integrations: z.object({
    discordRpcEnabled: z.boolean().default(true),
    discordAppId: z.string().default("1500617151684542594"),
    discordShowFile: z.boolean().default(true),
    discordShowProject: z.boolean().default(true),
  }).prefault({}),
  mcp: z.object({
    servers: z.array(z.object({
      name: z.string(),
      transport: z.enum(["stdio", "sse"]).default("stdio"),
      command: z.string().default(""),
      args: z.array(z.string()).default([]),
      env: z.record(z.string(), z.string()).default({}),
      url: z.string().optional(),
      enabled: z.boolean().default(true),
    })).default([]),
  }).prefault({ servers: [] }),
  keybindings: z.record(z.string(), z.string()).default({}),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsCategory = keyof Settings;

const STORE_FILE = "settings.json";
const STORE_KEY = "settings";

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  set: <K extends SettingsCategory>(category: K, partial: Partial<Settings[K]>) => Promise<void>;
  resetCategory: (category: SettingsCategory) => Promise<void>;
  resetAll: () => Promise<void>;
  reset: () => void;
}

const DEFAULTS: Settings = SettingsSchema.parse({});

let storeHandle: Awaited<ReturnType<typeof load>> | null = null;

async function persist(settings: Settings): Promise<void> {
  if (!storeHandle) {
    storeHandle = await load(STORE_FILE);
  }
  await storeHandle.set(STORE_KEY, settings);
  await storeHandle.save();
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULTS,
  loaded: false,
  load: async () => {
    storeHandle = await load(STORE_FILE);
    const raw = await storeHandle.get(STORE_KEY);
    const parsed = SettingsSchema.safeParse(raw ?? {});
    set({ settings: parsed.success ? parsed.data : DEFAULTS, loaded: true });
  },
  set: async (category, partial) => {
    const current = get().settings[category] as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(partial as Record<string, unknown>)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const next = { ...get().settings, [category]: merged } as Settings;
    const validated = SettingsSchema.parse(next);
    set({ settings: validated });
    await persist(validated);
  },
  resetCategory: async (category) => {
    const next = { ...get().settings, [category]: DEFAULTS[category] } as Settings;
    set({ settings: next });
    await persist(next);
  },
  resetAll: async () => {
    set({ settings: DEFAULTS });
    await persist(DEFAULTS);
  },
  reset: () => set({ settings: DEFAULTS, loaded: false }),
}));
