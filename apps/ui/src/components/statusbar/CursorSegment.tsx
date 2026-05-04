import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { useEditorCursor } from "../../stores/editorCursorStore";

export function CursorSegment(): JSX.Element {
  const { t } = useTranslation();
  const line = useEditorCursor((s) => s.line);
  const col = useEditorCursor((s) => s.col);
  const sel = useEditorCursor((s) => s.selectionLength);
  return (
    <span className="daisu-status-segment" title={t("statusbarSegment.cursorTitle")}>
      {t("statusbarSegment.cursorLabel", { line, col })}
      {sel > 0 ? t("statusbarSegment.cursorSelection", { count: sel }) : ""}
    </span>
  );
}
