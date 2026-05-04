import { useEffect, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { ThemePicker } from "../ThemePicker";
import { ToggleField } from "../controls/ToggleField";
import { SelectField } from "../controls/SelectField";
import { useThemes } from "../../../stores/themesStore";

export function ThemeSettings(): JSX.Element {
  const { t } = useTranslation();
  const bundled = useThemes((s) => s.bundled);
  const loadBundled = useThemes((s) => s.loadBundled);

  useEffect(() => {
    void loadBundled();
  }, [loadBundled]);

  const darkOptions = bundled
    .filter((t) => t.kind === "dark")
    .map((t) => ({ value: t.id as never, label: t.name }));
  const lightOptions = bundled
    .filter((t) => t.kind === "light")
    .map((t) => ({ value: t.id as never, label: t.name }));

  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">{t("settingsThemes.title")}</h2>
      <ThemePicker />
      <ToggleField
        category="themes"
        field="autoSwitchOnSystem"
        label="Auto-switch on system preference"
      />
      <SelectField
        category="themes"
        field="systemDarkTheme"
        label="System dark theme"
        options={darkOptions.length > 0 ? darkOptions : [{ value: "daisu-dark" as never, label: "Daisu Dark" }]}
      />
      <SelectField
        category="themes"
        field="systemLightTheme"
        label="System light theme"
        options={lightOptions.length > 0 ? lightOptions : [{ value: "daisu-light" as never, label: "Daisu Light" }]}
      />
    </div>
  );
}
