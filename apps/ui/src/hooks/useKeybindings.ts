import { useEffect } from "react";
import { tinykeys } from "tinykeys";
import { ACTIONS } from "../lib/keybinding-registry";
import { ACTION_HANDLERS, getActionContext } from "../lib/action-handlers";
import { useSettings } from "../stores/settingsStore";

export function useKeybindings(): void {
  const overrides = useSettings(
    (s) => s.settings.keybindings as Record<string, string>,
  );
  useEffect(() => {
    const bindings: Record<string, (e: KeyboardEvent) => void> = {};
    for (const action of ACTIONS) {
      const candidate = overrides[action.id];
      const combo = candidate === undefined ? action.defaultBinding : candidate;
      if (!combo) continue;
      bindings[combo] = (e) => {
        e.preventDefault();
        const fn = ACTION_HANDLERS[action.id];
        if (fn) fn(getActionContext());
      };
    }
    return tinykeys(window, bindings);
  }, [overrides]);
}
