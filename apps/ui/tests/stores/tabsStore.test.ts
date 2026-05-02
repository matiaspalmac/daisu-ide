import { describe, expect, it, beforeEach } from "vitest";
import { useTabs } from "../../src/stores/tabsStore";

describe("tabsStore", () => {
  beforeEach(() => useTabs.getState().reset());

  it("starts empty", () => {
    expect(useTabs.getState().tabs).toEqual([]);
    expect(useTabs.getState().activeTabId).toBeNull();
  });

  it("addTab appends and activates", () => {
    const s = useTabs.getState();
    const id = s.addTab({ path: "/x.ts", name: "x.ts", language: "typescript", content: "hi" });
    const next = useTabs.getState();
    expect(next.tabs).toHaveLength(1);
    expect(next.activeTabId).toBe(id);
    expect(next.tabs[0]!.savedContent).toBe("hi");
  });

  it("addTab activates existing if path matches", () => {
    const s = useTabs.getState();
    const idA = s.addTab({ path: "/x.ts", name: "x.ts", language: "typescript", content: "v1" });
    s.setActive(null);
    const idB = s.addTab({ path: "/x.ts", name: "x.ts", language: "typescript", content: "v2" });
    expect(idB).toBe(idA);
    expect(useTabs.getState().tabs).toHaveLength(1);
    expect(useTabs.getState().activeTabId).toBe(idA);
  });

  it("updateContent sets content but not savedContent", () => {
    const s = useTabs.getState();
    const id = s.addTab({ path: "/x.ts", name: "x.ts", language: "typescript", content: "v1" });
    s.updateContent(id, "v2");
    const tab = useTabs.getState().tabs.find((t) => t.id === id)!;
    expect(tab.content).toBe("v2");
    expect(tab.savedContent).toBe("v1");
    expect(useTabs.getState().isDirty(id)).toBe(true);
  });

  it("markSaved sets savedContent equal to current content", () => {
    const s = useTabs.getState();
    const id = s.addTab({ path: "/x.ts", name: "x.ts", language: "typescript", content: "v1" });
    s.updateContent(id, "v2");
    s.markSaved(id);
    expect(useTabs.getState().isDirty(id)).toBe(false);
  });

  it("closeTab removes and reactivates a sibling", () => {
    const s = useTabs.getState();
    const idA = s.addTab({ path: "/a.ts", name: "a.ts", language: "typescript", content: "" });
    const idB = s.addTab({ path: "/b.ts", name: "b.ts", language: "typescript", content: "" });
    s.closeTab(idB);
    const next = useTabs.getState();
    expect(next.tabs).toHaveLength(1);
    expect(next.activeTabId).toBe(idA);
  });
});
