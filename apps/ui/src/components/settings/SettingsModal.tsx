import { useState, type JSX } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useUI } from "../../stores/uiStore";
import {
  SettingsSidebar,
  type SettingsCategoryId,
} from "./SettingsSidebar";
import { GeneralSettings } from "./categories/GeneralSettings";
import { EditorSettings } from "./categories/EditorSettings";
import { ThemeSettings } from "./categories/ThemeSettings";
import { KeybindingSettings } from "./categories/KeybindingSettings";
import { AdvancedSettings } from "./categories/AdvancedSettings";

export function SettingsModal(): JSX.Element | null {
  const open = useUI((s) => s.settingsModalOpen);
  const closeSettings = useUI((s) => s.closeSettings);
  const [active, setActive] = useState<SettingsCategoryId>("general");

  if (!open) return null;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && closeSettings()}>
      <Dialog.Portal>
        <Dialog.Overlay className="daisu-modal-overlay" />
        <Dialog.Content
          className="daisu-settings-modal"
          aria-label="Settings"
          aria-describedby={undefined}
        >
          <header className="daisu-settings-header">
            <Dialog.Title className="daisu-settings-title">Settings</Dialog.Title>
            <button
              type="button"
              className="daisu-icon-btn"
              aria-label="Close settings"
              onClick={() => closeSettings()}
            >
              <X size={16} />
            </button>
          </header>
          <div className="daisu-settings-body">
            <SettingsSidebar active={active} onSelect={setActive} />
            <main className="daisu-settings-content">
              {active === "general" && <GeneralSettings />}
              {active === "editor" && <EditorSettings />}
              {active === "themes" && <ThemeSettings />}
              {active === "keybindings" && <KeybindingSettings />}
              {active === "advanced" && <AdvancedSettings />}
            </main>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
