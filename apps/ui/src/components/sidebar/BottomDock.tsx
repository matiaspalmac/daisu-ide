import type { JSX } from "react";
import {
  BookOpen,
  FileCode2,
  GitBranch,
  History,
  MessageSquare,
  Music2,
  type LucideIcon,
} from "lucide-react";
import { useUI } from "../../stores/uiStore";

const ICONS: LucideIcon[] = [
  Music2,
  FileCode2,
  History,
  MessageSquare,
  BookOpen,
  GitBranch,
];

export function BottomDock(): JSX.Element {
  const pushToast = useUI((s) => s.pushToast);

  const handle = (): void => {
    pushToast({
      message: "Integración disponible en milestones futuros",
      level: "info",
    });
  };

  return (
    <div className="px-3 py-3 flex justify-center">
      <div className="inline-flex items-center gap-1 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-md px-2 py-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
        {ICONS.map((Icon, i) => (
          <button
            key={i}
            type="button"
            onClick={handle}
            className="w-7 h-7 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] rounded-[var(--radius-sm)] transition-colors"
            aria-label="Integración"
          >
            <Icon size={14} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </div>
  );
}
