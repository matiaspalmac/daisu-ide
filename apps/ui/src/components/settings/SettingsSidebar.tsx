import type { JSX } from "react";

export type SettingsCategoryId =
  | "general"
  | "editor"
  | "themes"
  | "keybindings"
  | "advanced";

interface CategoryItem {
  id: SettingsCategoryId;
  label: string;
}

const CATEGORIES: CategoryItem[] = [
  { id: "general", label: "General" },
  { id: "editor", label: "Editor" },
  { id: "themes", label: "Themes" },
  { id: "keybindings", label: "Keybindings" },
  { id: "advanced", label: "Advanced" },
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
          className={`daisu-settings-nav-item${props.active === c.id ? " is-active" : ""}`}
          aria-current={props.active === c.id}
          onClick={() => props.onSelect(c.id)}
        >
          {c.label}
        </button>
      ))}
    </nav>
  );
}
