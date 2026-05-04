import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../../../stores/settingsStore";
import { useUI } from "../../../stores/uiStore";
import { exportSettingsCmd, importSettingsCmd } from "../../../api/tauri";
import { translateError } from "../../../lib/error-translate";

export function AdvancedSettings(): JSX.Element {
  const { t } = useTranslation();
  const resetAll = useSettings((s) => s.resetAll);
  const setSetting = useSettings((s) => s.set);
  const pushToast = useUI((s) => s.pushToast);
  const [resetOpen, setResetOpen] = useState(false);

  const handleExport = async (): Promise<void> => {
    try {
      const target = await saveDialog({
        title: t("settingsAdvanced.exportTitle"),
        defaultPath: t("settingsAdvanced.exportFile"),
      });
      if (typeof target !== "string") return;
      await exportSettingsCmd(target);
      pushToast({ message: t("settingsAdvanced.exportedToast"), level: "success" });
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  };

  const handleImport = async (): Promise<void> => {
    try {
      const source = await openDialog({
        title: t("settingsAdvanced.importTitle"),
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof source !== "string") return;
      const raw = (await importSettingsCmd(source)) as Record<string, unknown>;
      for (const cat of ["general", "editor", "themes", "keybindings"] as const) {
        if (raw && typeof raw === "object" && cat in raw) {
          await setSetting(cat, raw[cat] as never);
        }
      }
      pushToast({ message: t("settingsAdvanced.importedToast"), level: "success" });
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  };

  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">{t("settingsAdvanced.title")}</h2>
      <div className="daisu-field">
        <div className="daisu-field-text">
          <label className="daisu-field-label">{t("settingsAdvanced.resetAllLabel")}</label>
          <p className="daisu-field-desc">
            {t("settingsAdvanced.resetAllDesc")}
          </p>
        </div>
        <AlertDialog.Root open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialog.Trigger asChild>
            <button type="button" className="daisu-btn">{t("settingsAdvanced.resetAllButton")}</button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="daisu-modal-overlay" />
            <AlertDialog.Content className="daisu-modal">
              <AlertDialog.Title className="daisu-modal-title">
                {t("settingsAdvanced.resetDialogTitle")}
              </AlertDialog.Title>
              <AlertDialog.Description className="daisu-modal-body">
                {t("settingsAdvanced.resetDialogDesc")}
              </AlertDialog.Description>
              <div className="daisu-modal-actions">
                <button
                  type="button"
                  className="daisu-btn"
                  onClick={() => setResetOpen(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="daisu-btn-primary"
                  onClick={() => {
                    void resetAll();
                    setResetOpen(false);
                    pushToast({ message: t("settingsAdvanced.resetToast"), level: "success" });
                  }}
                >
                  {t("settingsAdvanced.resetButton")}
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
      <div className="daisu-field">
        <div className="daisu-field-text">
          <label className="daisu-field-label">{t("settingsAdvanced.exportLabel")}</label>
          <p className="daisu-field-desc">{t("settingsAdvanced.exportDesc")}</p>
        </div>
        <button type="button" className="daisu-btn" onClick={() => void handleExport()}>
          {t("settingsAdvanced.exportButton")}
        </button>
      </div>
      <div className="daisu-field">
        <div className="daisu-field-text">
          <label className="daisu-field-label">{t("settingsAdvanced.importLabel")}</label>
          <p className="daisu-field-desc">
            {t("settingsAdvanced.importDesc")}
          </p>
        </div>
        <button type="button" className="daisu-btn" onClick={() => void handleImport()}>
          {t("settingsAdvanced.importButton")}
        </button>
      </div>
    </div>
  );
}
