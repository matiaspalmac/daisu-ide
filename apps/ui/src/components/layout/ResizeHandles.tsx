import type { JSX } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../../lib/tauri-env";

type ResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

interface HandleSpec {
  dir: ResizeDirection;
  cls: string;
}

const HANDLE_HOVER =
  "hover:bg-[var(--accent)] hover:shadow-[var(--glow-cyan-sm)] transition-colors";

const HANDLES: HandleSpec[] = [
  { dir: "North", cls: `fixed top-0 left-0 right-0 h-px cursor-n-resize z-[100] ${HANDLE_HOVER}` },
  { dir: "South", cls: `fixed bottom-0 left-0 right-0 h-px cursor-s-resize z-[100] ${HANDLE_HOVER}` },
  { dir: "East", cls: `fixed top-0 right-0 bottom-0 w-px cursor-e-resize z-[100] ${HANDLE_HOVER}` },
  { dir: "West", cls: `fixed top-0 left-0 bottom-0 w-px cursor-w-resize z-[100] ${HANDLE_HOVER}` },
  { dir: "NorthEast", cls: "fixed top-0 right-0 w-2 h-2 cursor-ne-resize z-[101]" },
  { dir: "NorthWest", cls: "fixed top-0 left-0 w-2 h-2 cursor-nw-resize z-[101]" },
  { dir: "SouthEast", cls: "fixed bottom-0 right-0 w-2 h-2 cursor-se-resize z-[101]" },
  { dir: "SouthWest", cls: "fixed bottom-0 left-0 w-2 h-2 cursor-sw-resize z-[101]" },
];

export function ResizeHandles(): JSX.Element {
  return (
    <>
      {HANDLES.map((h) => (
        <div
          key={h.dir}
          className={h.cls}
          onMouseDown={(e) => {
            // Skip when mousedown originates on an interactive child element
            // (button, link, input, role=button). Without this guard the
            // resize handler swallows the click on buttons that happen to
            // sit within the 1-2px edge band.
            const t = e.target as HTMLElement | null;
            if (
              t &&
              t.closest(
                "button, a, input, textarea, select, [role='button'], [role='tab'], [role='menuitem']",
              )
            ) {
              return;
            }
            if (!isTauri()) return;
            e.preventDefault();
            try {
              void getCurrentWindow().startResizeDragging(h.dir);
            } catch {
              // browser preview or window unavailable
            }
          }}
        />
      ))}
    </>
  );
}
