import { useState, type JSX } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../../../stores/settingsStore";
import { useUI } from "../../../stores/uiStore";
import { exportSettingsCmd, importSettingsCmd } from "../../../api/tauri";
import { translateError } from "../../../lib/error-translate";

export function AdvancedSettings(): JSX.Element {
  const resetAll = useSettings((s) => s.resetAll);
  const setSetting = useSettings((s) => s.set);
  const pushToast = useUI((s) => s.pushToast);
  const [resetOpen, setResetOpen] = useState(false);

  const handleExport = async (): Promise<void> => {
    try {
      const target = await saveDialog({
        title: "Export Daisu settings",
        defaultPath: "daisu-settings.json",
      });
      if (typeof target !== "string") return;
      await exportSettingsCmd(target);
      pushToast({ message: "Settings exported.", level: "success" });
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  };

  const handleImport = async (): Promise<void> => {
    try {
      const source = await openDialog({
        title: "Import Daisu settings",
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
      pushToast({ message: "Settings imported.", level: "success" });
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  };

  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">Advanced</h2>
      <div className="daisu-field">
        <div className="daisu-field-text">
          <label className="daisu-field-label">Reset all settings to defaults</label>
          <p className="daisu-field-desc">
            Restores fonts, themes, keybindings, and toggles to their built-in values.
          </p>
        </div>
        <AlertDialog.Root open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialog.Trigger asChild>
            <button type="button" className="daisu-btn">Reset all</button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="daisu-modal-overlay" />
            <AlertDialog.Content className="daisu-modal">
              <AlertDialog.Title className="daisu-modal-title">
                Reset all settings?
              </AlertDialog.Title>
              <AlertDialog.Description className="daisu-modal-body">
                This restores every setting (fonts, themes, keybindings, toggles) to the
                built-in defaults. This action cannot be undone.
              </AlertDialog.Description>
              <div className="daisu-modal-actions">
                <button
                  type="button"
                  className="daisu-btn"
                  onClick={() => setResetOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="daisu-btn-primary"
                  onClick={() => {
                    void resetAll();
                    setResetOpen(false);
                    pushToast({ message: "Settings reset.", level: "success" });
                  }}
                >
                  Reset
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
      <div className="daisu-field">
        <div className="daisu-field-text">
          <label className="daisu-field-label">Export settings…</label>
          <p className="daisu-field-desc">Save the current settings file to disk as JSON.</p>
        </div>
        <button type="button" className="daisu-btn" onClick={() => void handleExport()}>
          Export
        </button>
      </div>
      <div className="daisu-field">
        <div className="daisu-field-text">
          <label className="daisu-field-label">Import settings…</label>
          <p className="daisu-field-desc">
            Load a previously exported settings JSON file. Each category is validated.
          </p>
        </div>
        <button type="button" className="daisu-btn" onClick={() => void handleImport()}>
          Import
        </button>
      </div>
    </div>
  );
}
