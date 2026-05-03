import type { JSX } from "react";
import { useEditorCursor } from "../../stores/editorCursorStore";

export function CursorSegment(): JSX.Element {
  const line = useEditorCursor((s) => s.line);
  const col = useEditorCursor((s) => s.col);
  const sel = useEditorCursor((s) => s.selectionLength);
  return (
    <span className="daisu-status-segment" title="Cursor position">
      Ln {line}, Col {col}
      {sel > 0 ? ` (${sel} sel)` : ""}
    </span>
  );
}
