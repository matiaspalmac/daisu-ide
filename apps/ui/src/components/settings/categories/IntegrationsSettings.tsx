import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ToggleField } from "../controls/ToggleField";
import { useSettings } from "../../../stores/settingsStore";

export function IntegrationsSettings(): JSX.Element {
  const { t } = useTranslation();
  const appId = useSettings((s) => s.settings.integrations.discordAppId);
  const setSetting = useSettings((s) => s.set);

  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">{t("settings.categories.integrations")}</h2>

      <h3 className="daisu-settings-section-title">{t("integrations.discordRpc")}</h3>
      <p className="daisu-settings-section-desc">{t("integrations.discordHint")}</p>

      <ToggleField
        category="integrations"
        field="discordRpcEnabled"
        label={t("integrations.enable")}
        description={t("integrations.enableDesc")}
      />
      <ToggleField
        category="integrations"
        field="discordShowProject"
        label={t("integrations.showProject")}
        description={t("integrations.showProjectDesc")}
      />
      <ToggleField
        category="integrations"
        field="discordShowFile"
        label={t("integrations.showFile")}
        description={t("integrations.showFileDesc")}
      />

      <div className="daisu-field">
        <div className="daisu-field-text">
          <label className="daisu-field-label" htmlFor="discord-app-id">
            {t("integrations.appId")}
          </label>
          <p className="daisu-field-desc">{t("integrations.appIdHint")}</p>
        </div>
        <input
          id="discord-app-id"
          type="text"
          className="daisu-input daisu-input-mono"
          value={appId}
          onChange={(e) =>
            void setSetting("integrations", { discordAppId: e.target.value })
          }
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
