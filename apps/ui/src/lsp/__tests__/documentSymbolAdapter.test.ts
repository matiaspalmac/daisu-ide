import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/lsp", () => ({ lspDocumentSymbol: vi.fn() }));

import { lspDocumentSymbol } from "../../lib/lsp";
import { makeDocumentSymbolProvider } from "../documentSymbolAdapter";

const fakeToken = { isCancellationRequested: false } as never;

function makeModel(path: string) {
  return { uri: { fsPath: path, scheme: "file" } as never } as never;
}

describe("documentSymbolAdapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes nested DocumentSymbol[] preserving children depth", async () => {
    (lspDocumentSymbol as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        name: "Outer",
        kind: 5,
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } },
        selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
        children: [{
          name: "inner",
          kind: 12,
          range: { start: { line: 1, character: 4 }, end: { line: 3, character: 5 } },
          selectionRange: { start: { line: 1, character: 8 }, end: { line: 1, character: 13 } },
        }],
      },
    ]);
    const provider = makeDocumentSymbolProvider("rust-analyzer");
    const result = await provider.provideDocumentSymbols!(makeModel("/x.rs"), fakeToken);
    const arr = result as Array<{ name: string; children?: unknown[] }>;
    expect(arr).toHaveLength(1);
    expect(arr[0]!.name).toBe("Outer");
    expect(arr[0]!.children).toHaveLength(1);
  });

  it("converts flat SymbolInformation[] synthesizing selectionRange", async () => {
    (lspDocumentSymbol as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        name: "foo",
        kind: 12,
        location: {
          uri: "file:///x.ts",
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 3 } },
        },
      },
    ]);
    const provider = makeDocumentSymbolProvider("tsserver");
    const result = await provider.provideDocumentSymbols!(makeModel("/x.ts"), fakeToken);
    const arr = result as Array<{ name: string; range: unknown; selectionRange: unknown }>;
    expect(arr).toHaveLength(1);
    expect(arr[0]!.selectionRange).toEqual(arr[0]!.range);
  });

  it("returns empty array on null", async () => {
    (lspDocumentSymbol as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const provider = makeDocumentSymbolProvider("rust-analyzer");
    const result = await provider.provideDocumentSymbols!(makeModel("/x.rs"), fakeToken);
    expect(result).toEqual([]);
  });
});
