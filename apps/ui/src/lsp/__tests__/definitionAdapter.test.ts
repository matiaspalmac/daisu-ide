import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/lsp", () => ({ lspDefinition: vi.fn() }));
vi.mock("../ensureModel", () => ({ ensureModel: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../monacoBridge", () => ({ flushPendingChange: vi.fn().mockResolvedValue(undefined) }));

import { lspDefinition } from "../../lib/lsp";
import { makeDefinitionProvider } from "../definitionAdapter";

const monacoMock = {
  Uri: {
    parse: (s: string) => ({ toString: () => s, fsPath: s.replace(/^file:\/\//, "") }),
  },
};

const fakeToken = { isCancellationRequested: false } as never;

function makeModel(path: string) {
  return { uri: { fsPath: path, scheme: "file" } as never } as never;
}

describe("definitionAdapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes LocationLink[] preserving originSelectionRange", async () => {
    (lspDefinition as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      originSelectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      targetUri: "file:///a.rs",
      targetRange: { start: { line: 5, character: 0 }, end: { line: 7, character: 0 } },
      targetSelectionRange: { start: { line: 5, character: 4 }, end: { line: 5, character: 8 } },
    }]);
    const provider = makeDefinitionProvider(monacoMock as never, "rust-analyzer");
    const result = await provider.provideDefinition!(
      makeModel("/x.rs"),
      { lineNumber: 1, column: 1 } as never,
      fakeToken,
    );
    const arr = result as Array<{ range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; originSelectionRange?: { startLineNumber: number; startColumn: number } }>;
    expect(arr).toHaveLength(1);
    expect(arr[0]!.range).toEqual({ startLineNumber: 6, startColumn: 5, endLineNumber: 6, endColumn: 9 });
    expect(arr[0]!.originSelectionRange).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 });
  });

  it("normalizes Location[] without originSelectionRange", async () => {
    (lspDefinition as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      uri: "file:///a.ts",
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } },
    }]);
    const provider = makeDefinitionProvider(monacoMock as never, "tsserver");
    const result = await provider.provideDefinition!(
      makeModel("/x.ts"),
      { lineNumber: 1, column: 1 } as never,
      fakeToken,
    );
    const arr = result as Array<{ originSelectionRange?: unknown }>;
    expect(arr).toHaveLength(1);
    expect(arr[0]!.originSelectionRange).toBeUndefined();
  });

  it("normalizes single Location scalar", async () => {
    (lspDefinition as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uri: "file:///a.rs",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    });
    const provider = makeDefinitionProvider(monacoMock as never, "rust-analyzer");
    const result = await provider.provideDefinition!(
      makeModel("/x.rs"),
      { lineNumber: 1, column: 1 } as never,
      fakeToken,
    );
    expect((result as unknown[]).length).toBe(1);
  });

  it("returns null on cancellation", async () => {
    (lspDefinition as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      uri: "file:///a.ts",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    }]);
    const provider = makeDefinitionProvider(monacoMock as never, "tsserver");
    const cancelled = { isCancellationRequested: true } as never;
    const result = await provider.provideDefinition!(
      makeModel("/x.ts"),
      { lineNumber: 1, column: 1 } as never,
      cancelled,
    );
    expect(result).toBeNull();
  });

  it("returns null on backend error", async () => {
    (lspDefinition as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const provider = makeDefinitionProvider(monacoMock as never, "rust-analyzer");
    const result = await provider.provideDefinition!(
      makeModel("/x.rs"),
      { lineNumber: 1, column: 1 } as never,
      fakeToken,
    );
    expect(result).toBeNull();
  });

  it("handles empty array", async () => {
    (lspDefinition as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const provider = makeDefinitionProvider(monacoMock as never, "rust-analyzer");
    const result = await provider.provideDefinition!(
      makeModel("/x.rs"),
      { lineNumber: 1, column: 1 } as never,
      fakeToken,
    );
    expect(result).toEqual([]);
  });
});
