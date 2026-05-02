import type { JSX } from "react";
import { useSettings, type Settings } from "../../../stores/settingsStore";

type NumberFields<T> = {
  [K in keyof T]: T[K] extends number ? K : never;
}[keyof T];

interface Props<C extends keyof Settings> {
  category: C;
  field: NumberFields<Settings[C]>;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}

export function NumberField<C extends keyof Settings>(props: Props<C>): JSX.Element {
  const value = useSettings(
    (s) => s.settings[props.category][props.field] as unknown as number,
  );
  const setSetting = useSettings((s) => s.set);
  return (
    <div className="daisu-field daisu-field-number">
      <label className="daisu-field-label">{props.label}</label>
      <input
        type="number"
        className="daisu-input daisu-input-number"
        value={value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          const clamped = Math.min(
            Math.max(n, props.min ?? Number.NEGATIVE_INFINITY),
            props.max ?? Number.POSITIVE_INFINITY,
          );
          void setSetting(props.category, {
            [props.field]: clamped,
          } as unknown as Partial<Settings[C]>);
        }}
      />
    </div>
  );
}
