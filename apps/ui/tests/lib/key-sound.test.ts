import { describe, expect, it } from "vitest";
import { keyKindFromCode } from "../../src/lib/key-sound";

describe("keyKindFromCode", () => {
  it("classifies space", () => {
    expect(keyKindFromCode("Space")).toBe("space");
  });
  it("classifies enter and numpad enter", () => {
    expect(keyKindFromCode("Enter")).toBe("enter");
    expect(keyKindFromCode("NumpadEnter")).toBe("enter");
  });
  it("classifies backspace and delete", () => {
    expect(keyKindFromCode("Backspace")).toBe("backspace");
    expect(keyKindFromCode("Delete")).toBe("backspace");
  });
  it("classifies modifier keys", () => {
    expect(keyKindFromCode("ShiftLeft")).toBe("modifier");
    expect(keyKindFromCode("ControlRight")).toBe("modifier");
    expect(keyKindFromCode("AltLeft")).toBe("modifier");
    expect(keyKindFromCode("MetaLeft")).toBe("modifier");
    expect(keyKindFromCode("CapsLock")).toBe("modifier");
    expect(keyKindFromCode("Tab")).toBe("modifier");
    expect(keyKindFromCode("Escape")).toBe("modifier");
  });
  it("returns null for navigation keys", () => {
    expect(keyKindFromCode("ArrowUp")).toBeNull();
    expect(keyKindFromCode("ArrowDown")).toBeNull();
    expect(keyKindFromCode("PageUp")).toBeNull();
    expect(keyKindFromCode("PageDown")).toBeNull();
    expect(keyKindFromCode("Home")).toBeNull();
    expect(keyKindFromCode("End")).toBeNull();
    expect(keyKindFromCode("Insert")).toBeNull();
    expect(keyKindFromCode("ContextMenu")).toBeNull();
  });
  it("returns null for function keys", () => {
    expect(keyKindFromCode("F1")).toBeNull();
    expect(keyKindFromCode("F12")).toBeNull();
  });
  it("classifies letter keys (e.g. F-prefixed words) as normal", () => {
    expect(keyKindFromCode("KeyA")).toBe("normal");
    expect(keyKindFromCode("KeyZ")).toBe("normal");
  });
  it("classifies digit keys as normal", () => {
    expect(keyKindFromCode("Digit0")).toBe("normal");
    expect(keyKindFromCode("Digit9")).toBe("normal");
  });
  it("classifies symbol keys as normal", () => {
    expect(keyKindFromCode("Semicolon")).toBe("normal");
    expect(keyKindFromCode("Comma")).toBe("normal");
    expect(keyKindFromCode("Period")).toBe("normal");
  });
});
