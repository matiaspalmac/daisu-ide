import type { JSX } from "react";
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
  label: string;
  icon?: PhosphorIcon;
  glyph?: string;
}

const CATEGORIES: CategoryItem[] = [
  { id: "general", label: "General", icon: Gear },
  { id: "keybindings", label: "Atajos", icon: Keyboard },
  { id: "editor", label: "Editor", icon: Code },
  { id: "themes", label: "Apariencia", icon: Palette },
  { id: "design", label: "Diseño", icon: SquaresFour },
  { id: "chat", label: "Chat", icon: Chat },
  { id: "ai", label: "Agente", icon: Robot },
  { id: "mcp", label: "MCP", glyph: "連" },
  { id: "integrations", label: "Integraciones", icon: Plugs },
  { id: "security", label: "Seguridad", icon: Shield },
  { id: "info", label: "Información", icon: Info },
  { id: "advanced", label: "Avanzado", icon: Wrench },
];

interface Props {
  active: SettingsCategoryId;
  onSelect: (id: SettingsCategoryId) => void;
}

export function SettingsSidebar(props: Props): JSX.Element {
  return (
    <nav className="daisu-settings-sidebar" aria-label="Settings categories">
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
          <span>{c.label}</span>
        </button>
      ))}
    </nav>
  );
}
