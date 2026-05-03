import { useEffect } from "react";
import { getActiveEditor } from "../lib/monaco-editor-ref";
import { useEditorCursor } from "../stores/editorCursorStore";

/**
 * Subscribes the active Monaco editor's cursor + selection events into
 * `editorCursorStore`. Mount this once at App level after the Editor has
 * had a chance to publish its ref.
 */
export function useEditorCursorWiring(): void {
  useEffect(() => {
    let disposers: Array<{ dispose(): void }> = [];
    let intervalId: number | null = null;

    function attach(): boolean {
      const editor = getActiveEditor();
      if (!editor) return false;
      const onPos = editor.onDidChangeCursorPosition((e) => {
        useEditorCursor.getState().set({
          line: e.position.lineNumber,
          col: e.position.column,
        });
      });
      const onSel = editor.onDidChangeCursorSelection(() => {
        const sel = editor.getSelection();
        const model = editor.getModel();
        const len = sel && model ? model.getValueInRange(sel).length : 0;
        useEditorCursor.getState().setSelectionLength(len);
      });
      disposers.push(onPos, onSel);
      return true;
    }

    if (!attach()) {
      intervalId = window.setInterval(() => {
        if (attach()) {
          if (intervalId !== null) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
        }
      }, 100);
    }

    return () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      for (const d of disposers) d.dispose();
      disposers = [];
      useEditorCursor.getState().clear();
    };
  }, []);
}
