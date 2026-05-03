import { create } from "zustand";

interface EditorCursorState {
  line: number;
  col: number;
  selectionLength: number;
  set(pos: { line: number; col: number }): void;
  setSelectionLength(n: number): void;
  clear(): void;
}

export const useEditorCursor = create<EditorCursorState>((set) => ({
  line: 1,
  col: 1,
  selectionLength: 0,
  set: (pos) => set({ line: pos.line, col: pos.col }),
  setSelectionLength: (n) => set({ selectionLength: Math.max(0, n) }),
  clear: () => set({ line: 1, col: 1, selectionLength: 0 }),
}));
