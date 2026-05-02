import type { JSX } from "react";
import { ToggleField } from "../controls/ToggleField";

export function GeneralSettings(): JSX.Element {
  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">General</h2>
      <ToggleField
        category="themes"
        field="autoSwitchOnSystem"
        label="Auto-switch theme based on OS preference"
        description="Daisu will follow Windows light/dark preference."
      />
      <ToggleField
        category="general"
        field="confirmCloseDirty"
        label="Confirm before closing tabs with unsaved changes"
      />
      <ToggleField
        category="general"
        field="restoreSessionOnStart"
        label="Restore last session on launch"
      />
    </div>
  );
}
