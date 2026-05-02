import { create } from "zustand";
import { z } from "zod";
import { load } from "@tauri-apps/plugin-store";

const SettingsSchema = z.object({
  general: z.object({
    autoSwitchSystemTheme: z.boolean().default(true),
    confirmCloseDirty: z.boolean().default(true),
    restoreSessionOnStart: z.boolean().default(true),
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
  }).prefault({}),
  themes: z.object({
    activeThemeId: z.string().default("daisu-dark"),
    autoSwitchOnSystem: z.boolean().default(true),
    systemDarkTheme: z.string().default("daisu-dark"),
    systemLightTheme: z.string().default("daisu-light"),
  }).prefault({}),
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
