import type { JSX } from "react";
import { ACTIONS } from "../../lib/keybinding-registry";
import { KeybindingField } from "./controls/KeybindingField";

export function KeybindingsList(): JSX.Element {
  // Collapse tabs.goto2..tabs.goto9 into a single header row backed by tabs.goto1.
  const visible = ACTIONS.filter((a) => !/^tabs\.goto[2-9]$/.test(a.id));

  return (
    <div className="daisu-keybindings">
      <div className="daisu-keybindings-header">
        <span>Action</span>
        <span>Category</span>
        <span>Binding</span>
        <span />
        <span />
      </div>
      {visible.map((action) => {
        const isGoto = action.id === "tabs.goto1";
        const label = isGoto ? "Go to tab 1–9" : action.label;
        const defaultBinding = isGoto ? "$mod+1..9" : action.defaultBinding;
        return (
          <div className="daisu-keybindings-row-wrap" key={action.id}>
            <span className="daisu-keybindings-cat">{action.category}</span>
            <KeybindingField
              actionId={action.id}
              actionLabel={label}
              defaultBinding={defaultBinding}
            />
          </div>
        );
      })}
    </div>
  );
}
