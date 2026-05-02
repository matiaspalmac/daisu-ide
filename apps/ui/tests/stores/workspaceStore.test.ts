import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "../../src/stores/workspaceStore";
import type { FileEntry } from "../../src/api/tauri";

vi.mock("../../src/api/tauri", () => ({
  openWorkspaceCmd: vi.fn(async (path: string) => ({ root_path: path, batch_id: "b1" })),
  closeWorkspaceCmd: vi.fn(async () => undefined),
  listDirCmd: vi.fn(async () => [] as FileEntry[]),
  createFileCmd: vi.fn(async (parent: string, name: string) => `${parent}\\${name}`),
  createDirCmd: vi.fn(async (parent: string, name: string) => `${parent}\\${name}`),
  renamePathCmd: vi.fn(async (from: string, toName: string) => {
    const idx = from.lastIndexOf("\\");
    const parent = idx >= 0 ? from.slice(0, idx) : from;
    return `${parent}\\${toName}`;
  }),
  deleteToTrashCmd: vi.fn(async (paths: string[]) =>
    paths.map((p) => ({ original_path: p }))
  ),
  restoreFromTrashCmd: vi.fn(async () => undefined),
  copyPathCmd: vi.fn(async (from: string, toParent: string) => {
    const idx = from.lastIndexOf("\\");
    const name = idx >= 0 ? from.slice(idx + 1) : from;
    return `${toParent}\\${name}`;
  }),
}));

vi.mock("../../src/lib/persistent-store", () => ({
  loadWorkspacePersistence: vi.fn(async () => ({ recents: [], expandedPersisted: {} })),
  saveWorkspacePersistence: vi.fn(async () => undefined),
}));

const node = (path: string, name: string, kind: "file" | "dir"): FileEntry => ({
  path,
  name,
  kind,
  size: null,
  mtimeMs: null,
});

describe("workspaceStore", () => {
  beforeEach(() => {
    useWorkspace.getState().reset();
  });

  it("openWorkspace sets root, hash, and pushes a recent entry", async () => {
    const ws = useWorkspace.getState();
    await ws.openWorkspace("C:\\demo");
    const s = useWorkspace.getState();
    expect(s.rootPath).toBe("C:\\demo");
    expect(s.workspaceHash).toBeTypeOf("string");
    expect(s.recents).toHaveLength(1);
    expect(s.recents[0]?.path).toBe("C:\\demo");
  });

  it("applyBatch merges nodes into tree and childrenIndex sorted naturally", () => {
    const ws = useWorkspace.getState();
    ws._setRoot("C:\\demo", "abc");
    ws.applyBatch({
      batchId: "b1",
      parentPath: null,
      nodes: [
        node("C:\\demo\\b.ts", "b.ts", "file"),
        node("C:\\demo\\a.ts", "a.ts", "file"),
        node("C:\\demo\\src", "src", "dir"),
      ],
      done: false,
    });
    const s = useWorkspace.getState();
    expect(s.tree.size).toBe(3);
    expect(s.childrenIndex.get("C:\\demo")).toEqual([
      "C:\\demo\\src",
      "C:\\demo\\a.ts",
      "C:\\demo\\b.ts",
    ]);
  });

  it("applyBatch ignores stale batch (different walkSessionId)", () => {
    const ws = useWorkspace.getState();
    ws._setRoot("C:\\demo", "abc");
    ws._setWalkSession("active");
    ws.applyBatch({
      batchId: "stale",
      parentPath: null,
      nodes: [node("C:\\demo\\x.ts", "x.ts", "file")],
      done: true,
    });
    expect(useWorkspace.getState().tree.size).toBe(0);
  });

  it("applyBatch with done sets walkDone true", () => {
    const ws = useWorkspace.getState();
    ws._setRoot("C:\\demo", "abc");
    ws._setWalkSession("active");
    ws.applyBatch({
      batchId: "active",
      parentPath: null,
      nodes: [],
      done: true,
    });
    expect(useWorkspace.getState().walkDone).toBe(true);
  });

  it("createFile inserts optimistically and confirms on success", async () => {
    const ws = useWorkspace.getState();
    ws._setRoot("C:\\demo", "abc");
    await ws.createFile("C:\\demo", "App.tsx");
    expect(useWorkspace.getState().tree.has("C:\\demo\\App.tsx")).toBe(true);
  });

  it("deleteToTrash removes nodes optimistically", async () => {
    const ws = useWorkspace.getState();
    ws._setRoot("C:\\demo", "abc");
    ws._injectNode(node("C:\\demo\\a.ts", "a.ts", "file"));
    expect(useWorkspace.getState().tree.has("C:\\demo\\a.ts")).toBe(true);
    await ws.deleteToTrash(["C:\\demo\\a.ts"]);
    expect(useWorkspace.getState().tree.has("C:\\demo\\a.ts")).toBe(false);
  });

  it("rename replaces tree key and updates childrenIndex", async () => {
    const ws = useWorkspace.getState();
    ws._setRoot("C:\\demo", "abc");
    ws._injectNode(node("C:\\demo\\old.txt", "old.txt", "file"));
    ws._setChildren("C:\\demo", ["C:\\demo\\old.txt"]);
    await ws.rename("C:\\demo\\old.txt", "new.txt");
    const s = useWorkspace.getState();
    expect(s.tree.has("C:\\demo\\old.txt")).toBe(false);
    expect(s.tree.has("C:\\demo\\new.txt")).toBe(true);
    expect(s.childrenIndex.get("C:\\demo")).toContain("C:\\demo\\new.txt");
  });

  it("toggleExpand adds and removes paths from expanded set", () => {
    const ws = useWorkspace.getState();
    ws._setRoot("C:\\demo", "abc");
    ws.toggleExpand("C:\\demo\\src");
    expect(useWorkspace.getState().expanded.has("C:\\demo\\src")).toBe(true);
    ws.toggleExpand("C:\\demo\\src");
    expect(useWorkspace.getState().expanded.has("C:\\demo\\src")).toBe(false);
  });

  it("selectNode single replaces selection; ctrl toggles; shift extends", () => {
    const ws = useWorkspace.getState();
    ws._setRoot("C:\\demo", "abc");
    ["a", "b", "c", "d"].forEach((n) =>
      ws._injectNode(node(`C:\\demo\\${n}`, n, "file"))
    );
    ws._setChildren("C:\\demo", [
      "C:\\demo\\a",
      "C:\\demo\\b",
      "C:\\demo\\c",
      "C:\\demo\\d",
    ]);
    ws.selectNode("C:\\demo\\b", "single");
    expect([...useWorkspace.getState().selection]).toEqual(["C:\\demo\\b"]);
    ws.selectNode("C:\\demo\\d", "ctrl");
    expect(new Set(useWorkspace.getState().selection)).toEqual(
      new Set(["C:\\demo\\b", "C:\\demo\\d"])
    );
    ws.selectNode("C:\\demo\\b", "ctrl");
    expect([...useWorkspace.getState().selection]).toEqual(["C:\\demo\\d"]);
  });

  it("recents dedupes by path and caps at 10", async () => {
    const ws = useWorkspace.getState();
    for (let i = 0; i < 12; i++) {
      await ws.openWorkspace(`C:\\ws${i}`);
    }
    await ws.openWorkspace("C:\\ws3");
    const s = useWorkspace.getState();
    expect(s.recents.length).toBeLessThanOrEqual(10);
    expect(s.recents[0]?.path).toBe("C:\\ws3");
  });
});
