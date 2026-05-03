import type { JSX, KeyboardEvent } from "react";
import { useRef } from "react";
import {
  Activity,
  Blocks,
  Files,
  GitBranch,
  Globe,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUI, type ActivityIcon } from "../../stores/uiStore";

interface Item {
  id: ActivityIcon;
  icon: LucideIcon;
  label: string;
  action: () => void;
}

export function ActivityBar(): JSX.Element {
  const active = useUI((s) => s.activeActivityIcon);
  const setActive = useUI((s) => s.setActiveActivityIcon);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const toggleSearch = useUI((s) => s.toggleSearchPanel);
  const openSettings = useUI((s) => s.openSettings);
  const pushToast = useUI((s) => s.pushToast);

  const placeholder = (id: ActivityIcon, label: string) => () => {
    setActive(id);
    pushToast({
      message: `${label} disponible en milestones futuros`,
      level: "info",
    });
  };

  const sidebarCollapsed = useUI((s) => s.sidebarCollapsed);
  const searchOpen = useUI((s) => s.searchPanelOpen);

  const items: Item[] = [
    {
      id: "files",
      icon: Files,
      label: "Explorador",
      action: () => {
        // Clicking Files when active+open → collapse. Otherwise → activate
        // and ensure sidebar is open. Decouples "what is showing" from "what
        // is active" so the indicator never lies about state.
        if (active === "files" && !sidebarCollapsed) {
          toggleSidebar();
        } else {
          setActive("files");
          if (sidebarCollapsed) toggleSidebar();
        }
      },
    },
    {
      id: "search",
      icon: Search,
      label: "Buscar",
      action: () => {
        if (active === "search" && searchOpen) {
          toggleSearch();
        } else {
          setActive("search");
          if (!searchOpen) toggleSearch();
        }
      },
    },
    {
      id: "git",
      icon: GitBranch,
      label: "Control de fuente",
      action: placeholder("git", "Control de fuente"),
    },
    {
      id: "extensions",
      icon: Blocks,
      label: "Extensiones",
      action: placeholder("extensions", "Extensiones"),
    },
    {
      id: "graph",
      icon: Globe,
      label: "Mapa proyecto",
      action: placeholder("graph", "Mapa proyecto"),
    },
    {
      id: "info",
      icon: Activity,
      label: "Estado",
      action: placeholder("info", "Estado"),
    },
  ];

  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyNav = (e: KeyboardEvent<HTMLButtonElement>, idx: number): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      items[idx]?.action();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const dir = e.key === "ArrowDown" ? 1 : -1;
    const next = (idx + dir + items.length) % items.length;
    buttonsRef.current[next]?.focus();
  };

  return (
    <aside
      role="tablist"
      aria-orientation="vertical"
      aria-label="Vistas de actividad"
      className="w-[var(--activitybar-w)] bg-[var(--bg-panel)] border-r border-[var(--border-subtle)] flex flex-col items-center py-2 gap-1"
    >
      {items.map((it, idx) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={active === it.id}
          tabIndex={active === it.id ? 0 : -1}
          ref={(el) => {
            buttonsRef.current[idx] = el;
          }}
          onClick={it.action}
          onKeyDown={(e) => onKeyNav(e, idx)}
          title={it.label}
          aria-label={it.label}
          className={cn(
            "relative w-10 h-10 grid place-items-center rounded-[var(--radius-sm)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--warn-soft)] transition-colors",
            "after:content-[''] after:absolute after:right-0 after:top-1.5 after:bottom-1.5 after:w-[2px] after:bg-transparent",
            active === it.id &&
              "text-[var(--warn)] bg-[var(--warn-soft)] after:bg-[var(--warn)] after:shadow-[var(--glow-orange-sm)]",
          )}
        >
          <it.icon size={18} strokeWidth={1.5} />
        </button>
      ))}

      <div className="flex-1" />

      <button
        type="button"
        title="Configuración"
        aria-label="Configuración"
        onClick={() => openSettings()}
        className="w-10 h-10 grid place-items-center rounded-[var(--radius-sm)] text-[var(--fg-muted)] hover:text-[var(--warn)] hover:bg-[var(--warn-soft)] transition-colors"
      >
        <Settings size={18} strokeWidth={1.5} />
      </button>
    </aside>
  );
}
