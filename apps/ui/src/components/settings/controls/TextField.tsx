import type { JSX } from "react";
import { useSettings, type Settings } from "../../../stores/settingsStore";

type StringFields<T> = {
  [K in keyof T]: T[K] extends string ? K : never;
}[keyof T];

interface Props<C extends keyof Settings> {
  category: C;
  field: StringFields<Settings[C]>;
  label: string;
  placeholder?: string;
}

export function TextField<C extends keyof Settings>(props: Props<C>): JSX.Element {
  const value = useSettings(
    (s) => s.settings[props.category][props.field] as unknown as string,
  );
  const setSetting = useSettings((s) => s.set);
  return (
    <div className="daisu-field daisu-field-text">
      <label className="daisu-field-label">{props.label}</label>
      <input
        type="text"
        className="daisu-input daisu-input-text"
        value={value}
        placeholder={props.placeholder}
        onChange={(e) =>
          void setSetting(props.category, {
            [props.field]: e.target.value,
          } as unknown as Partial<Settings[C]>)
        }
      />
    </div>
  );
}
