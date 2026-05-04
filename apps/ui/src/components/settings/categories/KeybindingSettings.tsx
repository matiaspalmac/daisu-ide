import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { KeybindingsList } from "../KeybindingsList";

export function KeybindingSettings(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">{t("settingsKeybindings.title")}</h2>
      <p className="daisu-keybindings-hint">
        {t("settingsKeybindings.hint")}
      </p>
      <KeybindingsList />
    </div>
  );
}
