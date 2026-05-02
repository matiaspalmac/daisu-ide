import { describe, expect, it } from "vitest";
import { basename, parent, joinPath, displayName } from "../../src/lib/path-utils";

describe("basename", () => {
  it("returns last segment of windows path", () => {
    expect(basename("C:\\Users\\Matias\\file.ts")).toBe("file.ts");
  });
  it("returns last segment of forward-slash path", () => {
    expect(basename("C:/Users/Matias/file.ts")).toBe("file.ts");
  });
  it("returns folder name when path ends with separator", () => {
    expect(basename("C:\\Users\\Matias\\")).toBe("Matias");
  });
  it("returns empty string for empty path", () => {
    expect(basename("")).toBe("");
  });
});

describe("parent", () => {
  it("returns parent dir of file path", () => {
    expect(parent("C:\\Users\\Matias\\file.ts")).toBe("C:\\Users\\Matias");
  });
  it("returns root for top-level entry", () => {
    expect(parent("C:\\file.ts")).toBe("C:\\");
  });
});

describe("joinPath", () => {
  it("joins two segments with separator", () => {
    expect(joinPath("C:\\Users", "Matias")).toBe("C:\\Users\\Matias");
  });
  it("trims trailing separator from base", () => {
    expect(joinPath("C:\\Users\\", "Matias")).toBe("C:\\Users\\Matias");
  });
});

describe("displayName", () => {
  it("returns basename for clear names", () => {
    expect(displayName("C:\\Proyectos\\daisu-ide")).toBe("daisu-ide");
  });
  it("returns parent/basename when basename is short or generic", () => {
    expect(displayName("C:\\Proyectos\\monorepo\\apps\\ui")).toBe("apps/ui");
  });
});
