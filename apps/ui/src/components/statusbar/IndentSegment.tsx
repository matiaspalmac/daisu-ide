import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../stores/settingsStore";
import { useUI } from "../../stores/uiStore";

export function IndentSegment(): JSX.Element {
  const { t } = useTranslation();
  const tabSize = useSettings((s) => s.settings.editor.tabSize);
  const insertSpaces = useSettings((s) => s.settings.editor.insertSpaces);
  const openSettings = useUI((s) => s.openSettings);
  const kind = insertSpaces
    ? t("statusbarSegment.indentSpaces")
    : t("statusbarSegment.indentTabSize");
  const label = t("statusbarSegment.indentLabel", { kind, size: tabSize });
  return (
    <button
      type="button"
      className="daisu-status-segment daisu-status-clickable"
      onClick={() => openSettings("editor")}
      title={t("statusbarSegment.indentTitle")}
    >
      {label}
    </button>
  );
}
