import type { JSX } from "react";
import { useSettings, type Settings } from "../../../stores/settingsStore";

interface Props<C extends keyof Settings, K extends keyof Settings[C]> {
  category: C;
  field: K;
  label: string;
  options: Array<{ value: Settings[C][K]; label: string }>;
}

export function SelectField<
  C extends keyof Settings,
  K extends keyof Settings[C],
>(props: Props<C, K>): JSX.Element {
  const value = useSettings((s) => s.settings[props.category][props.field]);
  const setSetting = useSettings((s) => s.set);
  return (
    <div className="daisu-field daisu-field-select">
      <label className="daisu-field-label">{props.label}</label>
      <select
        className="daisu-select"
        value={String(value)}
        onChange={(e) => {
          const next = props.options.find((o) => String(o.value) === e.target.value);
          if (next) {
            void setSetting(props.category, {
              [props.field]: next.value,
            } as unknown as Partial<Settings[C]>);
          }
        }}
      >
        {props.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
