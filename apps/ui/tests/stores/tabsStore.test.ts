import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabs } from "../../src/stores/tabsStore";

vi.mock("../../src/api/tauri", () => ({
  openFile: vi.fn(async (path: string) => ({
    path,
    contents: `seed:${path}`,
    language: "typescript",
    eol: "LF",
    encoding: "UTF-8",
  })),
  saveFile: vi.fn(async () => undefined),
  saveFileAsViaDialog: vi.fn(async (_contents: string) => `C:\\demo\\saved-as.ts`),
  saveSessionCmd: vi.fn(async () => undefined),
  loadSessionCmd: vi.fn(async () => null),
  deleteSessionCmd: vi.fn(async () => undefined),
}));

vi.mock("../../src/lib/monaco-models", () => ({
  disposeModel: vi.fn(),
  disposeAllModels: vi.fn(),
}));

beforeEach(() => useTabs.getState().reset());

describe("tabsStore — open/close/active", () => {
  it("openTab adds and activates a new tab", async () => {
    await useTabs.getState().openTab("C:\\demo\\a.ts");
    const s = useTabs.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.path).toBe("C:\\demo\\a.ts");
    expect(s.activeTabId).toBe(s.tabs[0]?.id);
  });

  it("openTab dedupes by path and re-activates", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    await tabs.openTab("C:\\b.ts");
    await tabs.openTab("C:\\a.ts");
    const s = useTabs.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeTabId).toBe(s.tabs.find((t) => t.path === "C:\\a.ts")?.id);
  });

  it("newTab creates an Untitled-N tab", () => {
    const tabs = useTabs.getState();
    tabs.newTab();
    tabs.newTab();
    const s = useTabs.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs[0]?.name).toBe("Untitled-1");
    expect(s.tabs[1]?.name).toBe("Untitled-2");
    expect(s.untitledCounter).toBe(2);
  });

  it("closeTab removes when not dirty and pushes to recentlyClosed", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    const id = useTabs.getState().tabs[0]!.id;
    await tabs.closeTab(id, true);
    const s = useTabs.getState();
    expect(s.tabs).toHaveLength(0);
    expect(s.activeTabId).toBeNull();
    expect(s.recentlyClosed).toHaveLength(1);
  });

  it("closeTab opens confirm modal when dirty and not forced", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    const id = useTabs.getState().tabs[0]!.id;
    tabs.updateContent(id, "different");
    await tabs.closeTab(id);
    expect(useTabs.getState().pendingClose?.mode).toBe("single");
    expect(useTabs.getState().tabs).toHaveLength(1);
  });

  it("setActive updates activeTabId and prepends to mruOrder", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    await tabs.openTab("C:\\b.ts");
    const ids = useTabs.getState().tabs.map((t) => t.id);
    tabs.setActive(ids[0]!);
    expect(useTabs.getState().activeTabId).toBe(ids[0]);
    expect(useTabs.getState().mruOrder[0]).toBe(ids[0]);
  });
});

describe("tabsStore — reorder/pin/cycle", () => {
  it("reorder moves a tab to a new index within its segment", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    await tabs.openTab("C:\\b.ts");
    await tabs.openTab("C:\\c.ts");
    const ids = useTabs.getState().tabs.map((t) => t.id);
    tabs.reorder(ids[0]!, 2);
    const order = useTabs.getState().tabs.map((t) => t.id);
    expect(order).toEqual([ids[1], ids[2], ids[0]]);
  });

  it("pin moves a tab to the front of pinned segment", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    await tabs.openTab("C:\\b.ts");
    const idB = useTabs.getState().tabs.find((t) => t.path === "C:\\b.ts")!.id;
    tabs.pin(idB);
    const s = useTabs.getState();
    expect(s.tabs[0]?.id).toBe(idB);
    expect(s.tabs[0]?.pinned).toBe(true);
  });

  it("unpin returns a tab to the unpinned segment", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    const id = useTabs.getState().tabs[0]!.id;
    tabs.pin(id);
    tabs.unpin(id);
    expect(useTabs.getState().tabs[0]?.pinned).toBe(false);
  });

  it("reorder of an unpinned tab cannot land in pinned segment", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    await tabs.openTab("C:\\b.ts");
    const ids = useTabs.getState().tabs.map((t) => t.id);
    tabs.pin(ids[0]!);
    tabs.reorder(ids[1]!, 0);
    const order = useTabs.getState().tabs.map((t) => t.id);
    expect(order[0]).toBe(ids[0]);
    expect(order[1]).toBe(ids[1]);
  });

  it("cycleTabs walks MRU order forward", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    await tabs.openTab("C:\\b.ts");
    await tabs.openTab("C:\\c.ts");
    tabs.cycleTabs(1);
    expect(
      useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeTabId)?.path,
    ).toBe("C:\\b.ts");
  });
});

describe("tabsStore — content / save / dirty", () => {
  it("updateContent marks the tab dirty (selector view)", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    const id = useTabs.getState().tabs[0]!.id;
    tabs.updateContent(id, "different");
    const tab = useTabs.getState().tabs.find((t) => t.id === id);
    expect(tab?.content !== tab?.savedContent).toBe(true);
  });

  it("saveActive snapshots savedContent", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    const id = useTabs.getState().tabs[0]!.id;
    tabs.updateContent(id, "different");
    await tabs.saveActive();
    const tab = useTabs.getState().tabs.find((t) => t.id === id);
    expect(tab?.savedContent).toBe("different");
  });
});

describe("tabsStore — recentlyClosed / reopen", () => {
  it("reopenClosed restores the most recently closed tab at the end", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    const id = useTabs.getState().tabs[0]!.id;
    await tabs.closeTab(id, true);
    await tabs.reopenClosed();
    const s = useTabs.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.path).toBe("C:\\a.ts");
    expect(s.recentlyClosed).toHaveLength(0);
  });

  it("recentlyClosed caps at 20", async () => {
    const tabs = useTabs.getState();
    for (let i = 0; i < 25; i++) {
      tabs.newTab();
      const id = useTabs.getState().tabs.at(-1)!.id;
      await tabs.closeTab(id, true);
    }
    expect(useTabs.getState().recentlyClosed).toHaveLength(20);
  });
});

describe("tabsStore — session", () => {
  it("saveSession writes a parseable blob", async () => {
    const tabs = useTabs.getState();
    await tabs.openTab("C:\\a.ts");
    tabs._setWorkspaceHash("hash-1");
    await tabs.saveSession();
    const { saveSessionCmd } = await import("../../src/api/tauri");
    expect(saveSessionCmd).toHaveBeenCalled();
  });

  it("restoreSession populates tabs and active", async () => {
    const { loadSessionCmd } = await import("../../src/api/tauri");
    (loadSessionCmd as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      version: 1,
      savedAt: 1,
      activeTabId: "tab-1",
      untitledCounter: 0,
      tabs: [
        {
          id: "tab-1",
          path: "C:\\a.ts",
          name: "a.ts",
          language: "typescript",
          content: "x",
          savedContent: "x",
          cursorState: null,
          pinned: false,
          untitledIndex: null,
        },
      ],
      mruOrder: ["tab-1"],
      recentlyClosed: [],
    });
    await useTabs.getState().restoreSession("hash-1");
    const s = useTabs.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe("tab-1");
  });
});
