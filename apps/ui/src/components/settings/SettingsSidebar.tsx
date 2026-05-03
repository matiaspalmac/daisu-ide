import type { JSX } from "react";
import {
  Info,
  Keyboard,
  LayoutGrid,
  MessageSquare,
  Palette,
  Shield,
  SquareCode,
  type LucideIcon,
} from "lucide-react";

export type SettingsCategoryId =
  | "general"
  | "editor"
  | "themes"
  | "design"
  | "chat"
  | "security"
  | "keybindings"
  | "info"
  | "advanced";

interface CategoryItem {
  id: SettingsCategoryId;
  label: string;
  icon: LucideIcon;
}

const CATEGORIES: CategoryItem[] = [
  { id: "keybindings", label: "Atajos", icon: Keyboard },
  { id: "editor", label: "Editor", icon: SquareCode },
  { id: "themes", label: "Apariencia", icon: Palette },
  { id: "design", label: "Diseño", icon: LayoutGrid },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "security", label: "Seguridad", icon: Shield },
  { id: "info", label: "Información", icon: Info },
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
          <c.icon size={14} />
          <span>{c.label}</span>
        </button>
      ))}
    </nav>
  );
}
