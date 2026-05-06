import { describe, expect, it, beforeEach } from "vitest";
import { useTerminal } from "../../src/stores/terminalStore";

describe("terminal store", () => {
  beforeEach(() => {
    useTerminal.setState({ open: false, tabs: [], activeId: null });
  });

  it("newTab opens panel and selects new tab", () => {
    useTerminal.getState().newTab();
    const s = useTerminal.getState();
    expect(s.open).toBe(true);
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(s.tabs[0]!.uiId);
  });

  it("closing the last tab closes panel", () => {
    useTerminal.getState().newTab();
    const id = useTerminal.getState().tabs[0]!.uiId;
    useTerminal.getState().closeTab(id);
    const s = useTerminal.getState();
    expect(s.tabs).toHaveLength(0);
    expect(s.open).toBe(false);
  });

  it("toggle flips open without affecting tabs", () => {
    useTerminal.getState().newTab();
    useTerminal.getState().toggle();
    expect(useTerminal.getState().open).toBe(false);
    useTerminal.getState().toggle();
    expect(useTerminal.getState().open).toBe(true);
  });
});
