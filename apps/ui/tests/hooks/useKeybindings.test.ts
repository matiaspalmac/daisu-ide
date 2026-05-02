import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tinykeysSpy, newTab, saveActive, closeActive } = vi.hoisted(() => ({
  tinykeysSpy: vi.fn(() => () => undefined),
  newTab: vi.fn(),
  saveActive: vi.fn(),
  closeActive: vi.fn(),
}));

vi.mock("tinykeys", () => ({ default: tinykeysSpy, tinykeys: tinykeysSpy }));

vi.mock("../../src/lib/action-handlers", () => ({
  getActionContext: () => ({}),
  ACTION_HANDLERS: {
    "file.new": () => newTab(),
    "file.save": () => saveActive(),
    "tabs.close": () => closeActive(),
  },
}));

vi.mock("../../src/stores/settingsStore", () => {
  const state = {
    settings: { keybindings: {} as Record<string, string> },
  };
  return {
    useSettings: Object.assign(
      <T,>(sel: (s: typeof state) => T) => sel(state),
      {
        getState: () => state,
        setState: (next: Partial<typeof state>) => Object.assign(state, next),
      },
    ),
  };
});

import { useKeybindings } from "../../src/hooks/useKeybindings";
import { useSettings } from "../../src/stores/settingsStore";

beforeEach(() => {
  tinykeysSpy.mockClear();
  newTab.mockReset();
  saveActive.mockReset();
  closeActive.mockReset();
  (useSettings.getState() as unknown as { settings: { keybindings: Record<string, string> } })
    .settings.keybindings = {};
});
afterEach(() => undefined);

describe("useKeybindings (registry-driven)", () => {
  it("calls tinykeys with default bindings on mount", () => {
    renderHook(() => useKeybindings());
    expect(tinykeysSpy).toHaveBeenCalledTimes(1);
    const [target, bindings] = (tinykeysSpy.mock.calls[0] as unknown as [Window, Record<string, (e: KeyboardEvent) => void>]);
    expect(target).toBe(window);
    expect(typeof bindings["$mod+s"]).toBe("function");
    expect(typeof bindings["$mod+n"]).toBe("function");
    expect(typeof bindings["$mod+w"]).toBe("function");
  });

  it("invokes the matching ACTION_HANDLERS entry", () => {
    renderHook(() => useKeybindings());
    const [, bindings] = (tinykeysSpy.mock.calls[0] as unknown as [Window, Record<string, (e: KeyboardEvent) => void>]);
    const fakeEvent = { preventDefault: vi.fn() } as unknown as KeyboardEvent;
    bindings["$mod+n"]!(fakeEvent);
    expect(newTab).toHaveBeenCalledTimes(1);
    expect(fakeEvent.preventDefault).toHaveBeenCalled();
  });

  it("user override replaces the default combo", () => {
    (useSettings.getState() as unknown as { settings: { keybindings: Record<string, string> } })
      .settings.keybindings = { "tabs.close": "$mod+q" };
    renderHook(() => useKeybindings());
    const [, bindings] = (tinykeysSpy.mock.calls[0] as unknown as [Window, Record<string, (e: KeyboardEvent) => void>]);
    expect(bindings["$mod+q"]).toBeDefined();
    expect(bindings["$mod+w"]).toBeUndefined();
  });

  it("blanked override removes the binding entirely", () => {
    (useSettings.getState() as unknown as { settings: { keybindings: Record<string, string> } })
      .settings.keybindings = { "tabs.close": "" };
    renderHook(() => useKeybindings());
    const [, bindings] = (tinykeysSpy.mock.calls[0] as unknown as [Window, Record<string, (e: KeyboardEvent) => void>]);
    expect(bindings["$mod+w"]).toBeUndefined();
    expect(bindings[""]).toBeUndefined();
  });
});
