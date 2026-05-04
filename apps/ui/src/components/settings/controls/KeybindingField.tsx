import { useEffect, useRef, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, ArrowCounterClockwise } from "@phosphor-icons/react";
import { useSettings } from "../../../stores/settingsStore";
import { useUI } from "../../../stores/uiStore";
import { ACTIONS } from "../../../lib/keybinding-registry";

interface Props {
  actionId: string;
  actionLabel: string;
  defaultBinding: string;
}

const RECORD_TIMEOUT_MS = 5000;

function comboToHuman(combo: string): string {
  return combo
    .replace(/\$mod/g, "Ctrl")
    .replace(/\+([a-z])$/i, (_m, k) => "+" + (k as string).toUpperCase());
}

function eventToCombo(e: KeyboardEvent): string | null {
  const k = e.key;
  if (k === "Control" || k === "Shift" || k === "Alt" || k === "Meta") return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("$mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (parts.length === 0) return null;
  parts.push(k.length === 1 ? k.toLowerCase() : k);
  return parts.join("+");
}

function findConflict(
  combo: string,
  ownActionId: string,
): { id: string; label: string } | null {
  const overrides = useSettings.getState().settings.keybindings as Record<string, string>;
  for (const action of ACTIONS) {
    if (action.id === ownActionId) continue;
    const candidate = overrides[action.id];
    const bound = candidate === undefined ? action.defaultBinding : candidate;
    if (bound === combo) return { id: action.id, label: action.label };
  }
  for (const [id, value] of Object.entries(overrides)) {
    if (id === ownActionId) continue;
    if (value === combo) {
      const def = ACTIONS.find((a) => a.id === id);
      return { id, label: def?.label ?? id };
    }
  }
  return null;
}

export function KeybindingField(props: Props): JSX.Element {
  const { t } = useTranslation();
  const override = useSettings(
    (s) => (s.settings.keybindings as Record<string, string>)[props.actionId],
  );
  const setSetting = useSettings((s) => s.set);
  const pushToast = useUI((s) => s.pushToast);
  const [recording, setRecording] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = override === undefined ? props.defaultBinding : override;

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent): void => {
      // Explicit Esc cancels recording without saving.
      if (e.key === "Escape") {
        e.preventDefault();
        setRecording(false);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return;
      e.preventDefault();
      const conflict = findConflict(combo, props.actionId);
      if (conflict) {
        pushToast({
          message: t("keybind.overrideToast", {
            combo: combo.replace("$mod", "Ctrl"),
            label: conflict.label,
          }),
          level: "warning",
        });
      }
      void setSetting("keybindings", {
        [props.actionId]: combo,
      } as never);
      setRecording(false);
    };
    window.addEventListener("keydown", onKey);
    timeoutRef.current = setTimeout(() => setRecording(false), RECORD_TIMEOUT_MS);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [recording, props.actionId, pushToast, setSetting, t]);

  const reset = (): void => {
    void setSetting("keybindings", { [props.actionId]: undefined as never } as never);
  };

  return (
    <div className="daisu-keybinding-row">
      <span className="daisu-keybinding-label">{props.actionLabel}</span>
      <span className="daisu-keybinding-combo">
        {recording ? t("keybind.press") : comboToHuman(current)}
      </span>
      <button
        type="button"
        aria-label={t("keybind.editAria")}
        className="daisu-icon-btn-sm"
        onClick={() => setRecording(true)}
      >
        <Pencil size={12} />
      </button>
      <button
        type="button"
        aria-label={t("keybind.resetAria")}
        className="daisu-icon-btn-sm"
        onClick={reset}
      >
        <ArrowCounterClockwise size={12} />
      </button>
    </div>
  );
}
