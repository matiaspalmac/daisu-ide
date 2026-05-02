import { describe, expect, it } from "vitest";
import {
  longestPrefixMatch,
  ruleCount,
  SCOPE_TOKEN_MAP,
} from "../../src/lib/scope-token-map";

describe("scope-token-map", () => {
  it("exposes a non-empty table", () => {
    expect(ruleCount()).toBeGreaterThanOrEqual(30);
    expect(SCOPE_TOKEN_MAP.length).toBe(ruleCount());
  });

  it("matches exact prefix", () => {
    expect(longestPrefixMatch("comment")).toBe("comment");
    expect(longestPrefixMatch("string")).toBe("string");
    expect(longestPrefixMatch("keyword")).toBe("keyword");
  });

  it("matches longer prefix before shorter", () => {
    expect(longestPrefixMatch("comment.line.double-slash")).toBe("comment.line");
    expect(longestPrefixMatch("constant.numeric")).toBe("number");
    expect(longestPrefixMatch("keyword.control")).toBe("keyword.control");
  });

  it("matches deep scopes via prefix dotted match", () => {
    expect(longestPrefixMatch("comment.line.double-slash.js")).toBe("comment.line");
    expect(longestPrefixMatch("entity.name.function.declaration.ts")).toBe("function");
    expect(longestPrefixMatch("variable.parameter.function.python")).toBe(
      "variable.parameter",
    );
  });

  it("returns empty string for unmapped scope", () => {
    expect(longestPrefixMatch("totally.unknown.scope")).toBe("");
  });

  it("does not partial-match a non-dotted suffix (no false positives)", () => {
    expect(longestPrefixMatch("stringy")).toBe("");
    expect(longestPrefixMatch("commenter")).toBe("");
  });

  it("storage.type wins over storage", () => {
    expect(longestPrefixMatch("storage.type")).toBe("type.keyword");
    expect(longestPrefixMatch("storage.modifier")).toBe("keyword.modifier");
    expect(longestPrefixMatch("storage")).toBe("keyword");
  });

  it("rules array ids are unique by prefix", () => {
    const seen = new Set<string>();
    for (const rule of SCOPE_TOKEN_MAP) {
      expect(seen.has(rule.prefix)).toBe(false);
      seen.add(rule.prefix);
    }
  });
});
