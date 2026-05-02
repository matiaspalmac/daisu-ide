import { describe, expect, it } from "vitest";
import { parseSessionBlob, EMPTY_SESSION } from "../../src/lib/session-schema";

describe("parseSessionBlob", () => {
  it("returns the parsed blob for a valid v1 shape", () => {
    const valid = {
      version: 1,
      savedAt: 1746210000000,
      activeTabId: "abc",
      untitledCounter: 3,
      tabs: [
        {
          id: "abc",
          path: "C:\\demo\\App.tsx",
          name: "App.tsx",
          language: "typescript",
          content: "x",
          savedContent: "x",
          cursorState: null,
          pinned: false,
          untitledIndex: null,
        },
      ],
      mruOrder: ["abc"],
      recentlyClosed: [],
    };
    const parsed = parseSessionBlob(valid);
    expect(parsed.activeTabId).toBe("abc");
    expect(parsed.tabs).toHaveLength(1);
    expect(parsed.untitledCounter).toBe(3);
  });

  it("returns EMPTY_SESSION for null", () => {
    expect(parseSessionBlob(null)).toEqual(EMPTY_SESSION);
  });

  it("returns EMPTY_SESSION for malformed shape", () => {
    expect(parseSessionBlob({ tabs: "not an array" })).toEqual(EMPTY_SESSION);
  });

  it("returns EMPTY_SESSION for unknown version", () => {
    expect(parseSessionBlob({ version: 999, tabs: [] })).toEqual(EMPTY_SESSION);
  });

  it("clamps recentlyClosed to 20 entries", () => {
    const closed = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      path: null,
      name: `Untitled-${i}`,
      language: "plaintext",
      content: "",
      savedContent: "",
      closedAt: i,
    }));
    const parsed = parseSessionBlob({
      version: 1,
      savedAt: 0,
      activeTabId: null,
      untitledCounter: 0,
      tabs: [],
      mruOrder: [],
      recentlyClosed: closed,
    });
    expect(parsed.recentlyClosed).toHaveLength(20);
  });

  it("EMPTY_SESSION is structurally usable", () => {
    expect(EMPTY_SESSION.tabs).toEqual([]);
    expect(EMPTY_SESSION.recentlyClosed).toEqual([]);
    expect(EMPTY_SESSION.activeTabId).toBeNull();
    expect(EMPTY_SESSION.untitledCounter).toBe(0);
  });
});
