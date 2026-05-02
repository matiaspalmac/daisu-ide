import { describe, expect, it, beforeEach } from "vitest";
import { useSearch } from "../../src/stores/searchStore";

describe("searchStore", () => {
  beforeEach(() => useSearch.getState().reset());

  it("starts with empty query and defaults", () => {
    const s = useSearch.getState();
    expect(s.query).toBe("");
    expect(s.replacement).toBe("");
    expect(s.caseSensitive).toBe(false);
    expect(s.useRegex).toBe(false);
    expect(s.wholeWord).toBe(false);
    expect(s.searching).toBe(false);
    expect(s.history).toEqual([]);
    expect(s.results).toEqual([]);
  });

  it("setQuery updates query without searching", () => {
    useSearch.getState().setQuery("foo");
    expect(useSearch.getState().query).toBe("foo");
  });

  it("toggleOption flips boolean options", () => {
    useSearch.getState().toggleOption("caseSensitive");
    expect(useSearch.getState().caseSensitive).toBe(true);
    useSearch.getState().toggleOption("useRegex");
    expect(useSearch.getState().useRegex).toBe(true);
  });

  it("pushHistory dedupes and caps at 10", () => {
    const s = useSearch.getState();
    for (let i = 0; i < 12; i += 1) s.pushHistory(`q${i}`);
    s.pushHistory("q5");
    const h = useSearch.getState().history;
    expect(h).toHaveLength(10);
    expect(h[0]).toBe("q5");
  });
});
