import type { JSX } from "react";
import { useSettings } from "../../stores/settingsStore";
import { useUI } from "../../stores/uiStore";

export function IndentSegment(): JSX.Element {
  const tabSize = useSettings((s) => s.settings.editor.tabSize);
  const insertSpaces = useSettings((s) => s.settings.editor.insertSpaces);
  const openSettings = useUI((s) => s.openSettings);
  const label = `${insertSpaces ? "Spaces" : "Tab Size"}: ${tabSize}`;
  return (
    <button
      type="button"
      className="daisu-status-segment daisu-status-clickable"
      onClick={() => openSettings("editor")}
      title="Indentation (click to open settings)"
    >
      {label}
    </button>
  );
}
