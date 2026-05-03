import type { JSX, MouseEvent } from "react";
import { Pin, X } from "lucide-react";
import type { OpenTab } from "../../stores/tabsStore";
import { useGit } from "../../stores/gitStore";
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { FileIcon } from "@/lib/file-icon";
import { cn } from "@/lib/cn";

interface Props {
  tab: OpenTab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  closestEdge: Edge | null;
  dragHandleRef?: ((el: HTMLDivElement | null) => void) | undefined;
}

export function Tab(props: Props): JSX.Element {
  const { tab, active, onActivate, onClose, closestEdge, dragHandleRef } = props;
  const dirty = tab.content !== tab.savedContent;
  const gitStatus = useGit((s) => (tab.path ? s.status(tab.path) : null));
  const gitClass = gitStatus ? ` daisu-git-${gitStatus.toLowerCase()}` : "";

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    if (e.button === 1) {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.button === 0) {
      // Activate on mousedown (not click) so it works on the very first press
      // when Monaco currently has focus.
      onActivate();
    }
  };

  return (
    <div
      ref={dragHandleRef}
      className={cn("daisu-tab group relative", active && "is-active")}
      onMouseDown={handleMouseDown}
      role="tab"
      aria-selected={active}
      title={tab.path ?? tab.name}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]"
        />
      )}
      {tab.pinned && (
        <Pin
          size={12}
          aria-label="Pinned"
          className="daisu-tab-pin text-[var(--accent)]"
          style={{ transform: "rotate(-45deg)" }}
        />
      )}
      <FileIcon name={tab.name} size={13} />
      <span className={`daisu-tab-name${gitClass}`}>{tab.name}</span>
      {dirty && (
        <span
          aria-hidden="true"
          className={cn(
            "daisu-tab-dirty text-[var(--accent)]",
            active && "text-base shadow-[0_0_4px_var(--accent)] rounded-full",
          )}
        >
          ●
        </span>
      )}
      <button
        type="button"
        aria-label="Close"
        className="daisu-tab-close hover:text-[var(--accent)]"
        onMouseDown={(e) => {
          // Stop the parent tab's mousedown handler so close does not also
          // activate. Browser's onClick wouldn't help — the parent now
          // listens on mousedown.
          e.stopPropagation();
          if (e.button === 0) onClose();
        }}
      >
        <X size={12} />
      </button>
      {closestEdge === "left" && (
        <span
          aria-hidden="true"
          className="daisu-tab-edge-left bg-[var(--accent)] shadow-[var(--glow-cyan-sm)]"
        />
      )}
      {closestEdge === "right" && (
        <span
          aria-hidden="true"
          className="daisu-tab-edge-right bg-[var(--accent)] shadow-[var(--glow-cyan-sm)]"
        />
      )}
    </div>
  );
}
