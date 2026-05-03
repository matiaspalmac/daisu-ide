import type { JSX } from "react";
import {
  BarChart3,
  BookOpen,
  Bookmark,
  Box,
  CheckSquare,
  FileCode2,
  GitBranch,
  Hexagon,
  History,
  MessageSquare,
  Music2,
  type LucideIcon,
} from "lucide-react";
import { useUI } from "../../stores/uiStore";

const ROW_1: LucideIcon[] = [
  Music2,
  FileCode2,
  History,
  Bookmark,
  MessageSquare,
  BookOpen,
  GitBranch,
];
const ROW_2: LucideIcon[] = [CheckSquare, Box, Hexagon, BarChart3];

export function BottomDock(): JSX.Element {
  const pushToast = useUI((s) => s.pushToast);

  const handle = (): void => {
    pushToast({
      message: "Integración disponible en milestones futuros",
      level: "info",
    });
  };

  const btnCls =
    "w-6 h-6 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] rounded-[var(--radius-sm)] transition-colors";

  return (
    <div className="px-3 py-2 border-t border-[var(--border-subtle)] flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        {ROW_1.map((Icon, i) => (
          <button
            key={`r1-${i}`}
            type="button"
            onClick={handle}
            className={btnCls}
            aria-label="Integración"
          >
            <Icon size={13} strokeWidth={1.5} />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        {ROW_2.map((Icon, i) => (
          <button
            key={`r2-${i}`}
            type="button"
            onClick={handle}
            className={btnCls}
            aria-label="Integración"
          >
            <Icon size={13} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </div>
  );
}
