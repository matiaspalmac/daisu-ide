import type { JSX } from "react";
import {
  BookOpen,
  ClipboardText,
  GitFork,
  ClockCounterClockwise,
  ChatCircle,
} from "@phosphor-icons/react";
import type { ComponentType, SVGProps } from "react";
import { useUI } from "../../stores/uiStore";

// Inline brand SVG for Spotify (lucide does not ship brand icons). Path
// from simple-icons project (CC0). Sized via `width`/`height` and inheriting
// `currentColor` so it matches the surrounding dock styling.
function SpotifyIcon({ size = 14, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...rest}
    >
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

interface IconSpec {
  Icon: ComponentType<{ size?: number }>;
  label: string;
}

// Mapped 1:1 with reference image copy 4.png from left to right:
// 1. Spotify disc (custom SVG), 2. clipboard list, 3. history clock,
// 4. round speech bubble, 5. open book, 6. fork/share branches.
const ICONS: IconSpec[] = [
  { Icon: SpotifyIcon, label: "Spotify" },
  { Icon: ClipboardText, label: "Notas" },
  { Icon: ClockCounterClockwise, label: "Historial" },
  { Icon: ChatCircle, label: "Chat" },
  { Icon: BookOpen, label: "Documentación" },
  { Icon: GitFork, label: "Compartir" },
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
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-0.5 bg-[var(--bg-elevated)] rounded-full px-1 py-0.5 shadow-[0_2px_6px_rgba(0,0,0,0.5)] pointer-events-auto"
      role="toolbar"
      aria-label="Integraciones"
    >
      {ICONS.map(({ Icon, label }, i) => (
        <button
          key={i}
          type="button"
          onClick={handle}
          className="w-6 h-6 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] rounded-full transition-colors"
          aria-label={label}
          title={label}
        >
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
}
