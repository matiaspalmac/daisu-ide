import { describe, expect, it } from "vitest";
import { lspPositionToMonaco, lspRangeToMonaco } from "../positions";

describe("lspPositionToMonaco", () => {
  it("shifts 0-based to 1-based", () => {
    expect(lspPositionToMonaco({ line: 0, character: 0 })).toEqual({
      lineNumber: 1,
      column: 1,
    });
  });

  it("preserves UTF-16 columns away from boundary", () => {
    expect(lspPositionToMonaco({ line: 5, character: 12 })).toEqual({
      lineNumber: 6,
      column: 13,
    });
  });
});

describe("lspRangeToMonaco", () => {
  it("converts both endpoints", () => {
    expect(
      lspRangeToMonaco({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
      }),
    ).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 6,
    });
  });

  it("handles multi-line range", () => {
    expect(
      lspRangeToMonaco({
        start: { line: 3, character: 4 },
        end: { line: 7, character: 1 },
      }),
    ).toEqual({
      startLineNumber: 4,
      startColumn: 5,
      endLineNumber: 8,
      endColumn: 2,
    });
  });
});
