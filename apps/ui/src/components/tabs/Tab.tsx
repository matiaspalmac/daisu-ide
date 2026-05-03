import type { JSX, MouseEvent } from "react";
import { PushPin, X } from "@phosphor-icons/react";
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
    }
  };

  return (
    <div
      ref={dragHandleRef}
      className={cn(
        "daisu-tab group relative",
        active && "is-active",
        tab.pinned && "is-pinned",
      )}
      onClick={onActivate}
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
        <span
          aria-hidden="true"
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-[var(--warn)] shadow-[var(--glow-orange-sm)]"
        />
      )}
      {tab.pinned && (
        <PushPin
          size={11}
          weight="fill"
          aria-label="Pinned"
          className="daisu-tab-pin text-[var(--warn)] shrink-0"
        />
      )}
      <FileIcon name={tab.name} size={13} />
      <span className={`daisu-tab-name${gitClass}`}>{tab.name}</span>
      {dirty && (
        <span
          aria-label="Sin guardar"
          title="Sin guardar"
          className={cn("daisu-tab-dirty-dot", active && "is-active")}
        />
      )}
      {!tab.pinned && (
        <button
          type="button"
          aria-label="Close"
          className="daisu-tab-close hover:text-[var(--accent)]"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={12} />
        </button>
      )}
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
