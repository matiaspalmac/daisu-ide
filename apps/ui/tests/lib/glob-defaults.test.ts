import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCLUDE_GLOBS,
  mergeExcludeGlobs,
} from "../../src/lib/glob-defaults";

describe("DEFAULT_EXCLUDE_GLOBS", () => {
  it("includes node_modules and target", () => {
    expect(DEFAULT_EXCLUDE_GLOBS).toContain("node_modules/**");
    expect(DEFAULT_EXCLUDE_GLOBS).toContain("target/**");
    expect(DEFAULT_EXCLUDE_GLOBS).toContain(".git/**");
  });
});

describe("mergeExcludeGlobs", () => {
  it("merges defaults with user globs", () => {
    const merged = mergeExcludeGlobs(["coverage/**"]);
    expect(merged).toContain("node_modules/**");
    expect(merged).toContain("coverage/**");
  });

  it("dedupes overlapping entries", () => {
    const merged = mergeExcludeGlobs(["node_modules/**", "coverage/**"]);
    expect(merged.filter((g) => g === "node_modules/**").length).toBe(1);
  });

  it("skips empty user entries", () => {
    const merged = mergeExcludeGlobs(["", "  ", "x/**"]);
    expect(merged).not.toContain("");
    expect(merged).toContain("x/**");
  });
});
