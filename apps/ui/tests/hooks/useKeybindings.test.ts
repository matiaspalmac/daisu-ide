import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeybindings } from "../../src/hooks/useKeybindings";

const saveActive = vi.fn();
const saveActiveAs = vi.fn();
const newTab = vi.fn();
const closeActive = vi.fn();
const cycle = vi.fn();
const reopenClosed = vi.fn();
const setActiveByIndex = vi.fn();

vi.mock("../../src/stores/tabsStore", () => ({
  useTabs: {
    getState: () => ({
      saveActive,
      saveActiveAs,
      newTab,
      closeActive,
      cycleTabs: cycle,
      reopenClosed,
      setActiveByIndex,
    }),
  },
}));

beforeEach(() => {
  saveActive.mockReset();
  saveActiveAs.mockReset();
  newTab.mockReset();
  closeActive.mockReset();
  cycle.mockReset();
  reopenClosed.mockReset();
  setActiveByIndex.mockReset();
});
afterEach(() => undefined);

function press(key: string, opts: { ctrl?: boolean; shift?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
}

describe("useKeybindings", () => {
  it("Ctrl+S calls saveActive", () => {
    renderHook(() => useKeybindings());
    press("s", { ctrl: true });
    expect(saveActive).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+S calls saveActiveAs", () => {
    renderHook(() => useKeybindings());
    press("S", { ctrl: true, shift: true });
    expect(saveActiveAs).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+N calls newTab", () => {
    renderHook(() => useKeybindings());
    press("n", { ctrl: true });
    expect(newTab).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+W calls closeActive", () => {
    renderHook(() => useKeybindings());
    press("w", { ctrl: true });
    expect(closeActive).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Tab cycles forward", () => {
    renderHook(() => useKeybindings());
    press("Tab", { ctrl: true });
    expect(cycle).toHaveBeenCalledWith(1);
  });

  it("Ctrl+Shift+Tab cycles backward", () => {
    renderHook(() => useKeybindings());
    press("Tab", { ctrl: true, shift: true });
    expect(cycle).toHaveBeenCalledWith(-1);
  });

  it("Ctrl+Shift+T reopens closed", () => {
    renderHook(() => useKeybindings());
    press("T", { ctrl: true, shift: true });
    expect(reopenClosed).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+1 jumps to tab index 0", () => {
    renderHook(() => useKeybindings());
    press("1", { ctrl: true });
    expect(setActiveByIndex).toHaveBeenCalledWith(0);
  });

  it("Ctrl+9 jumps to tab index 8", () => {
    renderHook(() => useKeybindings());
    press("9", { ctrl: true });
    expect(setActiveByIndex).toHaveBeenCalledWith(8);
  });

  it("removes listener on unmount", () => {
    const { unmount } = renderHook(() => useKeybindings());
    unmount();
    press("s", { ctrl: true });
    expect(saveActive).not.toHaveBeenCalled();
  });
});
