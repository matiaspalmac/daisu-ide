import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import {
  Info,
  Keyboard,
  SquaresFour,
  Chat,
  Palette,
  Gear,
  Plugs,
  Robot,
  Shield,
  Code,
  Wrench,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

export type SettingsCategoryId =
  | "general"
  | "editor"
  | "themes"
  | "design"
  | "chat"
  | "ai"
  | "mcp"
  | "integrations"
  | "security"
  | "keybindings"
  | "info"
  | "advanced";

interface CategoryItem {
  id: SettingsCategoryId;
  icon?: PhosphorIcon;
  glyph?: string;
}

const CATEGORIES: CategoryItem[] = [
  { id: "general", icon: Gear },
  { id: "keybindings", icon: Keyboard },
  { id: "editor", icon: Code },
  { id: "themes", icon: Palette },
  { id: "design", icon: SquaresFour },
  { id: "chat", icon: Chat },
  { id: "ai", icon: Robot },
  { id: "mcp", glyph: "連" },
  { id: "integrations", icon: Plugs },
  { id: "security", icon: Shield },
  { id: "info", icon: Info },
  { id: "advanced", icon: Wrench },
];

function categoryLabel(t: ReturnType<typeof useTranslation>["t"], id: SettingsCategoryId): string {
  switch (id) {
    case "general": return t("settings.categories.general");
    case "keybindings": return t("settings.categories.shortcuts");
    case "editor": return t("settings.categories.editor");
    case "themes": return t("settings.categories.appearance");
    case "design": return t("settings.categories.design");
    case "chat": return t("settings.categories.chat");
    case "ai": return t("settings.categories.agent");
    case "mcp": return t("settings.categories.mcp");
    case "integrations": return t("settings.categories.integrations");
    case "security": return t("settings.categories.security");
    case "info": return t("settings.categories.info");
    case "advanced": return t("settings.categories.advanced");
  }
}

interface Props {
  active: SettingsCategoryId;
  onSelect: (id: SettingsCategoryId) => void;
}

export function SettingsSidebar(props: Props): JSX.Element {
  const { t } = useTranslation();
  return (
    <nav className="daisu-settings-sidebar" aria-label={t("settings.sidebarAria")}>
      {CATEGORIES.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`daisu-settings-nav-item flex items-center gap-2${
            props.active === c.id ? " is-active" : ""
          }`}
          aria-current={props.active === c.id}
          onClick={() => props.onSelect(c.id)}
        >
          {c.icon ? (
            <c.icon size={14} />
          ) : (
            <span className="daisu-glyph" aria-hidden="true">
              {c.glyph}
            </span>
          )}
          <span>{categoryLabel(t, c.id)}</span>
        </button>
      ))}
    </nav>
  );
}
