import { beforeEach, describe, expect, it } from "vitest";
import { useEditorCursor } from "../../src/stores/editorCursorStore";

describe("editorCursorStore", () => {
  beforeEach(() => {
    useEditorCursor.getState().clear();
  });

  it("defaults to line 1 col 1 zero selection", () => {
    const s = useEditorCursor.getState();
    expect(s.line).toBe(1);
    expect(s.col).toBe(1);
    expect(s.selectionLength).toBe(0);
  });

  it("set updates line and col", () => {
    useEditorCursor.getState().set({ line: 42, col: 7 });
    const s = useEditorCursor.getState();
    expect(s.line).toBe(42);
    expect(s.col).toBe(7);
  });

  it("setSelectionLength clamps negatives to zero", () => {
    useEditorCursor.getState().setSelectionLength(-5);
    expect(useEditorCursor.getState().selectionLength).toBe(0);
  });

  it("clear resets to defaults", () => {
    useEditorCursor.getState().set({ line: 99, col: 99 });
    useEditorCursor.getState().setSelectionLength(123);
    useEditorCursor.getState().clear();
    const s = useEditorCursor.getState();
    expect(s.line).toBe(1);
    expect(s.col).toBe(1);
    expect(s.selectionLength).toBe(0);
  });
});
