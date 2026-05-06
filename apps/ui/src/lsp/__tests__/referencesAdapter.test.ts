import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/lsp", () => ({ lspReferences: vi.fn() }));
vi.mock("../ensureModel", () => ({ ensureModel: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../monacoBridge", () => ({
  flushPendingChange: vi.fn().mockResolvedValue(undefined),
  // Tests build fake models without `trackModelOpen`, so the real
  // `pathOfModel` would return null. Mirror the historical behaviour
  // (read fsPath off the URI) so existing fixtures stay green.
  pathOfModel: vi.fn((m: { uri: { fsPath?: string; path: string } }) =>
    m.uri.fsPath ?? m.uri.path,
  ),
  modelOfPath: vi.fn(() => null),
}));

import { lspReferences } from "../../lib/lsp";
import { makeReferenceProvider } from "../referencesAdapter";

const monacoMock = {
  Uri: { parse: (s: string) => ({ toString: () => s, fsPath: s.replace(/^file:\/\//, "") }) },
};
const fakeToken = { isCancellationRequested: false } as never;

function makeModel(path: string) {
  return { uri: { fsPath: path, scheme: "file" } as never } as never;
}

function makeRefs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    uri: `file:///r${i}.rs`,
    range: { start: { line: i, character: 0 }, end: { line: i, character: 1 } },
  }));
}

describe("referencesAdapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards includeDeclaration flag to backend", async () => {
    (lspReferences as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const provider = makeReferenceProvider(monacoMock as never, "rust-analyzer");
    await provider.provideReferences!(
      makeModel("/x.rs"),
      { lineNumber: 1, column: 1 } as never,
      { includeDeclaration: true } as never,
      fakeToken,
    );
    expect(lspReferences).toHaveBeenCalledWith(
      "/x.rs",
      0,
      0,
      true,
      "rust-analyzer",
    );
  });

  it("caps results at 200", async () => {
    (lspReferences as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeRefs(500));
    const provider = makeReferenceProvider(monacoMock as never, "rust-analyzer");
    const result = await provider.provideReferences!(
      makeModel("/x.rs"),
      { lineNumber: 1, column: 1 } as never,
      { includeDeclaration: false } as never,
      fakeToken,
    );
    expect((result as unknown[]).length).toBe(200);
  });

  it("returns empty for empty backend result", async () => {
    (lspReferences as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const provider = makeReferenceProvider(monacoMock as never, "rust-analyzer");
    const result = await provider.provideReferences!(
      makeModel("/x.rs"),
      { lineNumber: 1, column: 1 } as never,
      { includeDeclaration: false } as never,
      fakeToken,
    );
    expect(result).toEqual([]);
  });
});
