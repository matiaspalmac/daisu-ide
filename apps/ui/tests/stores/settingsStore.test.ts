import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (_key: string) => undefined),
    set: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

import { useSettings } from "../../src/stores/settingsStore";

describe("settingsStore", () => {
  beforeEach(() => useSettings.getState().reset());

  it("starts with default editor settings", () => {
    const s = useSettings.getState();
    expect(s.settings.editor.fontSize).toBe(13);
    expect(s.settings.editor.tabSize).toBe(2);
    expect(s.settings.editor.wordWrap).toBe("off");
  });

  it("starts with default theme settings", () => {
    expect(useSettings.getState().settings.themes.activeThemeId).toBe("daisu-dark");
    expect(useSettings.getState().settings.themes.autoSwitchOnSystem).toBe(true);
  });

  it("set updates a partial category", async () => {
    await useSettings.getState().set("editor", { fontSize: 16 });
    expect(useSettings.getState().settings.editor.fontSize).toBe(16);
    expect(useSettings.getState().settings.editor.tabSize).toBe(2);
  });

  it("set rejects invalid values per Zod", async () => {
    await expect(
      useSettings.getState().set("editor", { fontSize: 999 } as never),
    ).rejects.toThrow();
  });

  it("resetCategory restores defaults for that category only", async () => {
    await useSettings.getState().set("editor", { fontSize: 16 });
    await useSettings.getState().set("themes", { activeThemeId: "custom" });
    await useSettings.getState().resetCategory("editor");
    const s = useSettings.getState();
    expect(s.settings.editor.fontSize).toBe(13);
    expect(s.settings.themes.activeThemeId).toBe("custom");
  });
});
