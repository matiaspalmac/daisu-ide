import { useEffect, useState, type JSX } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";
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
import { Disenio } from "./categories/Disenio";
import { IntegrationsSettings } from "./categories/IntegrationsSettings";
import { AiSettings } from "./categories/AiSettings";
import { StubCategory } from "./categories/StubCategory";

const VALID_CATEGORIES: SettingsCategoryId[] = [
  "general",
  "editor",
  "themes",
  "design",
  "chat",
  "ai",
  "integrations",
  "security",
  "keybindings",
  "info",
  "advanced",
];

export function SettingsModal(): JSX.Element | null {
  const open = useUI((s) => s.settingsModalOpen);
  const closeSettings = useUI((s) => s.closeSettings);
  const requestedCategory = useUI((s) => s.settingsActiveCategory);
  const [active, setActive] = useState<SettingsCategoryId>("general");

  // Honor the deep-link from `openSettings("themes")` etc. by syncing the
  // store's category every time the modal opens.
  useEffect(() => {
    if (!open) return;
    const target = VALID_CATEGORIES.includes(
      requestedCategory as SettingsCategoryId,
    )
      ? (requestedCategory as SettingsCategoryId)
      : "general";
    setActive(target);
  }, [open, requestedCategory]);

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
            <Dialog.Title className="daisu-settings-title">
              <span className="daisu-glyph" aria-hidden="true">設</span>
              Configuración
            </Dialog.Title>
            <button
              type="button"
              className="daisu-icon-btn"
              aria-label="Cerrar configuración"
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
              {active === "design" && <Disenio />}
              {active === "integrations" && <IntegrationsSettings />}
              {active === "ai" && <AiSettings />}
              {active === "chat" && (
                <StubCategory
                  title="Chat"
                  message="Configuración avanzada de chat e historial llega en M4."
                />
              )}
              {active === "security" && (
                <StubCategory
                  title="Seguridad"
                  message="Almacenamiento de API keys via OS keychain + permisos de plugins en M3."
                />
              )}
              {active === "keybindings" && <KeybindingSettings />}
              {active === "info" && (
                <StubCategory
                  title="Información"
                  message="Versión, licencias y sistema. Detallado en M3."
                />
              )}
              {active === "advanced" && <AdvancedSettings />}
            </main>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
