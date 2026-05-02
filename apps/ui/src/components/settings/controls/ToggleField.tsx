import type { JSX } from "react";
import { useSettings, type Settings } from "../../../stores/settingsStore";

type BooleanFields<T> = {
  [K in keyof T]: T[K] extends boolean ? K : never;
}[keyof T];

interface Props<C extends keyof Settings> {
  category: C;
  field: BooleanFields<Settings[C]>;
  label: string;
  description?: string;
}

export function ToggleField<C extends keyof Settings>(props: Props<C>): JSX.Element {
  const value = useSettings(
    (s) => s.settings[props.category][props.field] as unknown as boolean,
  );
  const setSetting = useSettings((s) => s.set);
  const toggle = (): void => {
    void setSetting(props.category, {
      [props.field]: !value,
    } as unknown as Partial<Settings[C]>);
  };
  return (
    <div className="daisu-field daisu-field-toggle">
      <div className="daisu-field-text">
        <label className="daisu-field-label">{props.label}</label>
        {props.description && (
          <p className="daisu-field-desc">{props.description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        className={`daisu-toggle${value ? " is-on" : ""}`}
        onClick={toggle}
      >
        <span className="daisu-toggle-thumb" aria-hidden="true" />
      </button>
    </div>
  );
}
