import { describe, expect, it, vi } from "vitest";
import { applyWorkspaceEdit } from "../workspaceEditApplier";

vi.mock("../ensureModel", () => ({
  ensureModel: vi.fn(),
}));

import { ensureModel } from "../ensureModel";

function makeFakeMonaco(modelMap: Map<string, FakeModel>) {
  return {
    Uri: { parse: (u: string) => ({ toString: () => u }) },
    editor: {
      getModel: (uri: { toString(): string }) => modelMap.get(uri.toString()) ?? null,
    },
  } as unknown as typeof import("monaco-editor");
}

class FakeModel {
  versionId = 1;
  pushed: { range: unknown; text: string }[] = [];
  pushEditOperations(_a: unknown, ops: { range: unknown; text: string }[]): void {
    this.pushed.push(...ops);
  }
  getVersionId(): number {
    return this.versionId;
  }
}

describe("applyWorkspaceEdit", () => {
  it("applies legacy changes-map and counts files", async () => {
    const m = new FakeModel();
    const map = new Map<string, FakeModel>([["file:///tmp/x.rs", m]]);
    vi.mocked(ensureModel).mockResolvedValue(undefined);
    const result = await applyWorkspaceEdit(makeFakeMonaco(map), {
      changes: {
        "file:///tmp/x.rs": [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            newText: "bar",
          },
        ],
      },
    });
    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(m.pushed).toHaveLength(1);
    expect(m.pushed[0]?.text).toBe("bar");
  });

  it("sorts edits descending by start position", async () => {
    const m = new FakeModel();
    const map = new Map<string, FakeModel>([["file:///tmp/x.rs", m]]);
    vi.mocked(ensureModel).mockResolvedValue(undefined);
    await applyWorkspaceEdit(makeFakeMonaco(map), {
      changes: {
        "file:///tmp/x.rs": [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            newText: "first-in-source",
          },
          {
            range: { start: { line: 5, character: 4 }, end: { line: 5, character: 8 } },
            newText: "later-in-source",
          },
        ],
      },
    });
    // Later-in-source line should be applied first (descending order).
    expect(m.pushed[0]?.text).toBe("later-in-source");
    expect(m.pushed[1]?.text).toBe("first-in-source");
  });

  it("applies documentChanges with version check", async () => {
    const m = new FakeModel();
    m.versionId = 4;
    const map = new Map<string, FakeModel>([["file:///tmp/x.rs", m]]);
    vi.mocked(ensureModel).mockResolvedValue(undefined);
    const result = await applyWorkspaceEdit(makeFakeMonaco(map), {
      documentChanges: [
        {
          textDocument: { uri: "file:///tmp/x.rs", version: 4 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
              newText: "foo",
            },
          ],
        },
      ],
    });
    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([]);
  });

  it("skips on version mismatch when client raced ahead", async () => {
    const m = new FakeModel();
    m.versionId = 99; // user typed many times since prepareRename
    const map = new Map<string, FakeModel>([["file:///tmp/x.rs", m]]);
    vi.mocked(ensureModel).mockResolvedValue(undefined);
    const result = await applyWorkspaceEdit(makeFakeMonaco(map), {
      documentChanges: [
        {
          textDocument: { uri: "file:///tmp/x.rs", version: 4 },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
              newText: "foo",
            },
          ],
        },
      ],
    });
    expect(result.applied).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe("version-mismatch");
  });

  it("falls back to documentChanges when both shapes provided", async () => {
    const m = new FakeModel();
    const map = new Map<string, FakeModel>([["file:///tmp/x.rs", m]]);
    vi.mocked(ensureModel).mockResolvedValue(undefined);
    const result = await applyWorkspaceEdit(makeFakeMonaco(map), {
      changes: { "file:///nope/y.rs": [] },
      documentChanges: [
        {
          textDocument: { uri: "file:///tmp/x.rs", version: null },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
              newText: "z",
            },
          ],
        },
      ],
    });
    expect(result.applied).toBe(1);
  });

  it("decodes Windows file:/// URIs back to drive paths", async () => {
    const m = new FakeModel();
    const map = new Map<string, FakeModel>([
      ["file:///C:/proj/x.rs", m],
    ]);
    vi.mocked(ensureModel).mockResolvedValue(undefined);
    const result = await applyWorkspaceEdit(makeFakeMonaco(map), {
      changes: {
        "file:///C:/proj/x.rs": [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            newText: "x",
          },
        ],
      },
    });
    expect(result.applied).toBe(1);
  });
});
