import { describe, expect, it } from "vitest";
import { iconForSymbolKind } from "../symbolIcons";
import { LspSymbolKind } from "../types";

describe("iconForSymbolKind", () => {
  it("maps Function kind to function family", () => {
    expect(iconForSymbolKind(LspSymbolKind.Function).family).toBe("function");
  });

  it("maps Struct kind to class family", () => {
    expect(iconForSymbolKind(LspSymbolKind.Struct).family).toBe("class");
  });

  it("maps Field kind to field family", () => {
    expect(iconForSymbolKind(LspSymbolKind.Field).family).toBe("field");
  });

  it("maps File kind to file family", () => {
    expect(iconForSymbolKind(LspSymbolKind.File).family).toBe("file");
  });

  it("falls back to unknown for unrecognised kind", () => {
    expect(iconForSymbolKind(999).family).toBe("unknown");
  });
});
