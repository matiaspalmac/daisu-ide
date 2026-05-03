import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

vi.mock("../../src/api/tauri", () => ({
  searchWorkspaceCmd: vi.fn(async () => ({
    requestId: "x",
    totalHits: 0,
    filesSearched: 0,
    truncated: false,
  })),
  cancelSearchCmd: vi.fn(async () => undefined),
  replaceInWorkspaceCmd: vi.fn(async () => ({
    filesModified: 0,
    totalReplacements: 0,
    errors: [],
  })),
}));

import {
  searchWorkspaceCmd,
  cancelSearchCmd,
  replaceInWorkspaceCmd,
} from "../../src/api/tauri";
import { useSearch } from "../../src/stores/searchStore";

beforeEach(() => {
  useSearch.getState().reset();
  (searchWorkspaceCmd as ReturnType<typeof vi.fn>).mockClear();
  (cancelSearchCmd as ReturnType<typeof vi.fn>).mockClear();
  (replaceInWorkspaceCmd as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => undefined);

describe("searchStore", () => {
  it("setQuery updates the query string", () => {
    useSearch.getState().setQuery("foo");
    expect(useSearch.getState().query).toBe("foo");
  });

  it("toggleOption flips a boolean option", () => {
    useSearch.getState().toggleOption("regex");
    expect(useSearch.getState().options.regex).toBe(true);
    useSearch.getState().toggleOption("regex");
    expect(useSearch.getState().options.regex).toBe(false);
  });

  it("ingestHits accumulates hits in order", () => {
    useSearch.getState().ingestHits([
      {
        id: "1",
        path: "a.ts",
        lineNo: 1,
        lineText: "x",
        matchStartCol: 0,
        matchEndCol: 1,
      },
      {
        id: "2",
        path: "a.ts",
        lineNo: 2,
        lineText: "y",
        matchStartCol: 0,
        matchEndCol: 1,
      },
    ]);
    useSearch.getState().ingestHits([
      {
        id: "3",
        path: "b.ts",
        lineNo: 1,
        lineText: "z",
        matchStartCol: 0,
        matchEndCol: 1,
      },
    ]);
    expect(useSearch.getState().hits).toHaveLength(3);
  });

  it("ingestProgress updates filesSearched", () => {
    useSearch.getState().ingestProgress(42);
    expect(useSearch.getState().filesSearched).toBe(42);
  });

  it("markDone sets done flag and truncated", () => {
    useSearch.getState().markDone(true);
    expect(useSearch.getState().done).toBe(true);
    expect(useSearch.getState().truncated).toBe(true);
  });

  it("toggleHitExcluded adds and removes id", () => {
    useSearch.getState().toggleHitExcluded("h1");
    expect(useSearch.getState().excludedHitIds.has("h1")).toBe(true);
    useSearch.getState().toggleHitExcluded("h1");
    expect(useSearch.getState().excludedHitIds.has("h1")).toBe(false);
  });

  it("clearResults wipes hits/progress/excluded", () => {
    useSearch.getState().ingestHits([
      {
        id: "1",
        path: "a",
        lineNo: 1,
        lineText: "",
        matchStartCol: 0,
        matchEndCol: 1,
      },
    ]);
    useSearch.getState().toggleHitExcluded("1");
    useSearch.getState().clearResults();
    expect(useSearch.getState().hits).toHaveLength(0);
    expect(useSearch.getState().excludedHitIds.size).toBe(0);
    expect(useSearch.getState().filesSearched).toBe(0);
    expect(useSearch.getState().done).toBe(false);
  });

  it("pushRecentQuery deduplicates and caps at 20", () => {
    for (let i = 0; i < 25; i++) {
      useSearch.getState().pushRecentQuery(`q${i}`);
    }
    expect(useSearch.getState().recentQueries).toHaveLength(20);
    expect(useSearch.getState().recentQueries[0]).toBe("q24");
    useSearch.getState().pushRecentQuery("q24");
    expect(useSearch.getState().recentQueries).toHaveLength(20);
    expect(useSearch.getState().recentQueries[0]).toBe("q24");
  });
});
