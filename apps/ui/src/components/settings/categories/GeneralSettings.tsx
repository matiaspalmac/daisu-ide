import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ToggleField } from "../controls/ToggleField";
import { useSettings } from "../../../stores/settingsStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import type { AppLanguage } from "../../../i18n";

const LANGUAGES: AppLanguage[] = ["en", "es", "ja"];

export function GeneralSettings(): JSX.Element {
  const { t } = useTranslation();
  const language = useSettings((s) => s.settings.general.language);
  const setSetting = useSettings((s) => s.set);

  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">{t("settings.categories.general")}</h2>

      <div className="mb-6 flex flex-col gap-1">
        <label className="daisu-field-label">{t("language.label")}</label>
        <p className="daisu-field-desc">{t("language.description")}</p>
        <Select
          value={language}
          onValueChange={(v) => void setSetting("general", { language: v as AppLanguage })}
        >
          <SelectTrigger className="w-48 mt-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((lng) => (
              <SelectItem key={lng} value={lng}>
                {t(`language.${lng}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
