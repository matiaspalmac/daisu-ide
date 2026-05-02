import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const defineTheme = vi.fn();
const setTheme = vi.fn();

vi.mock("../../src/lib/monaco-editor-ref", () => ({
  getMonacoNamespace: () => ({ editor: { defineTheme, setTheme } }),
  getActiveEditor: () => null,
}));

vi.mock("../../src/api/tauri", () => ({
  readThemeJsonCmd: vi.fn(async (id: string) => ({
    name: id === "daisu-dark" ? "Daisu Dark" : "Daisu Light",
    type: id === "daisu-dark" ? "dark" : "light",
    colors: {
      "editor.background": id === "daisu-dark" ? "#1f1f1f" : "#ffffff",
      "editor.foreground": id === "daisu-dark" ? "#cccccc" : "#3b3b3b",
      "sideBar.background": id === "daisu-dark" ? "#181818" : "#f8f8f8",
    },
    tokenColors: [
      { scope: "comment", settings: { foreground: "#6a9955", fontStyle: "italic" } },
    ],
  })),
  listBundledThemesCmd: vi.fn(async () => [
    { id: "daisu-dark", name: "Daisu Dark", kind: "dark" },
    { id: "daisu-light", name: "Daisu Light", kind: "light" },
  ]),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));

import { useTheme, applyTheme } from "../../src/hooks/useTheme";
import { useSettings } from "../../src/stores/settingsStore";

beforeEach(() => {
  defineTheme.mockReset();
  setTheme.mockReset();
  useSettings.setState({
    settings: {
      general: {
        autoSwitchSystemTheme: false,
        confirmCloseDirty: true,
        restoreSessionOnStart: true,
      },
      editor: {
        fontSize: 13,
        fontFamily: "Cascadia Code",
        tabSize: 2,
        insertSpaces: true,
        wordWrap: "off",
        minimap: false,
        lineNumbers: "on",
        cursorStyle: "line",
        smoothScrolling: true,
        bracketPairColorization: true,
        formatOnSave: false,
      },
      themes: {
        activeThemeId: "daisu-dark",
        autoSwitchOnSystem: false,
        systemDarkTheme: "daisu-dark",
        systemLightTheme: "daisu-light",
      },
      keybindings: {},
    } as never,
    loaded: true,
  });
});
afterEach(() => {
  document.documentElement.style.cssText = "";
});

describe("applyTheme", () => {
  it("calls monaco.defineTheme + setTheme with converted data", async () => {
    await applyTheme("daisu-dark");
    expect(defineTheme).toHaveBeenCalledTimes(1);
    expect(setTheme).toHaveBeenCalledWith("daisu-dark");
    const [id, data] = defineTheme.mock.calls[0]!;
    expect(id).toBe("daisu-dark");
    expect(data.base).toBe("vs-dark");
    expect(data.colors["editor.background"]).toBe("#1f1f1f");
  });

  it("writes CSS vars to documentElement", async () => {
    await applyTheme("daisu-dark");
    expect(document.documentElement.style.getPropertyValue("--daisu-bg")).toBe("#1f1f1f");
    expect(document.documentElement.style.getPropertyValue("--daisu-sidebar-bg")).toBe(
      "#181818",
    );
  });
});

describe("useTheme", () => {
  it("applies the active theme on mount", async () => {
    renderHook(() => useTheme());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(setTheme).toHaveBeenCalledWith("daisu-dark");
  });

  it("re-applies when activeThemeId changes", async () => {
    const { rerender } = renderHook(() => useTheme());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    setTheme.mockClear();
    act(() => {
      useSettings.setState((s) => ({
        settings: {
          ...s.settings,
          themes: { ...s.settings.themes, activeThemeId: "daisu-light" },
        },
      }));
    });
    rerender();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(setTheme).toHaveBeenCalledWith("daisu-light");
  });
});
