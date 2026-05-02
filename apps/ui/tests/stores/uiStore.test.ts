import { describe, expect, it, beforeEach } from "vitest";
import { useUI } from "../../src/stores/uiStore";

describe("uiStore", () => {
  beforeEach(() => useUI.getState().reset());

  it("starts with default panel widths", () => {
    const s = useUI.getState();
    expect(s.sidebarWidth).toBe(240);
    expect(s.agentsPanelWidth).toBe(320);
    expect(s.searchPanelHeight).toBe(240);
  });

  it("starts with sidebar+agents visible, search collapsed", () => {
    const s = useUI.getState();
    expect(s.sidebarCollapsed).toBe(false);
    expect(s.agentsPanelCollapsed).toBe(false);
    expect(s.searchPanelOpen).toBe(false);
  });

  it("toggleSidebar flips collapsed", () => {
    const s = useUI.getState();
    s.toggleSidebar();
    expect(useUI.getState().sidebarCollapsed).toBe(true);
    s.toggleSidebar();
    expect(useUI.getState().sidebarCollapsed).toBe(false);
  });

  it("openSettings sets active category", () => {
    const s = useUI.getState();
    s.openSettings("editor");
    expect(useUI.getState().settingsModalOpen).toBe(true);
    expect(useUI.getState().settingsActiveCategory).toBe("editor");
  });

  it("openSettings without category defaults to 'general'", () => {
    const s = useUI.getState();
    s.openSettings();
    expect(useUI.getState().settingsActiveCategory).toBe("general");
  });

  it("pushToast appends and dismissToast removes by id", () => {
    const s = useUI.getState();
    s.pushToast({ message: "hello", level: "info" });
    expect(useUI.getState().toasts).toHaveLength(1);
    const id = useUI.getState().toasts[0]!.id;
    s.dismissToast(id);
    expect(useUI.getState().toasts).toHaveLength(0);
  });

  it("setSidebarWidth clamps to bounds [120, 600]", () => {
    const s = useUI.getState();
    s.setSidebarWidth(50);
    expect(useUI.getState().sidebarWidth).toBe(120);
    s.setSidebarWidth(900);
    expect(useUI.getState().sidebarWidth).toBe(600);
    s.setSidebarWidth(300);
    expect(useUI.getState().sidebarWidth).toBe(300);
  });
});
