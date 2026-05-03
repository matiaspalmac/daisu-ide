import type { JSX } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

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

const HANDLES: HandleSpec[] = [
  { dir: "North", cls: "fixed top-0 left-0 right-0 h-1 cursor-n-resize z-[100]" },
  { dir: "South", cls: "fixed bottom-0 left-0 right-0 h-1 cursor-s-resize z-[100]" },
  { dir: "East", cls: "fixed top-0 right-0 bottom-0 w-1 cursor-e-resize z-[100]" },
  { dir: "West", cls: "fixed top-0 left-0 bottom-0 w-1 cursor-w-resize z-[100]" },
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
            e.preventDefault();
            void getCurrentWindow().startResizeDragging(h.dir);
          }}
        />
      ))}
    </>
  );
}
