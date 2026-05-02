import type { JSX } from "react";
import { KeybindingsList } from "../KeybindingsList";

export function KeybindingSettings(): JSX.Element {
  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">Keybindings</h2>
      <p className="daisu-keybindings-hint">
        Click the pencil to record a new shortcut. Press Esc, click outside, or wait 5 s
        to cancel. Reset returns the binding to its default.
      </p>
      <KeybindingsList />
    </div>
  );
}
