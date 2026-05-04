import { useEffect, useState, type JSX } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
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
import { Design } from "./categories/Design";
import { IntegrationsSettings } from "./categories/IntegrationsSettings";
import { AiSettings } from "./categories/AiSettings";
import { McpSettings } from "./categories/McpSettings";
import { StubCategory } from "./categories/StubCategory";

const VALID_CATEGORIES: SettingsCategoryId[] = [
  "general",
  "editor",
  "themes",
  "design",
  "chat",
  "ai",
  "mcp",
  "integrations",
  "security",
  "keybindings",
  "info",
  "advanced",
];

export function SettingsModal(): JSX.Element | null {
  const { t } = useTranslation();
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
              {t("settings.title")}
            </Dialog.Title>
            <button
              type="button"
              className="daisu-icon-btn"
              aria-label={t("settings.closeAria")}
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
              {active === "design" && <Design />}
              {active === "integrations" && <IntegrationsSettings />}
              {active === "ai" && <AiSettings />}
              {active === "mcp" && <McpSettings />}
              {active === "chat" && (
                <StubCategory
                  title={t("settings.categories.chat")}
                  message={t("settings.stub.chat")}
                />
              )}
              {active === "security" && (
                <StubCategory
                  title={t("settings.categories.security")}
                  message={t("settings.stub.security")}
                />
              )}
              {active === "keybindings" && <KeybindingSettings />}
              {active === "info" && (
                <StubCategory
                  title={t("settings.categories.info")}
                  message={t("settings.stub.info")}
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
