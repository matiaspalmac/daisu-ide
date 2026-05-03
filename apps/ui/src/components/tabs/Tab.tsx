import type { JSX, MouseEvent } from "react";
import clsx from "clsx";
import { Pin, X } from "lucide-react";
import type { OpenTab } from "../../stores/tabsStore";
import { useGit } from "../../stores/gitStore";
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";

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
      className={clsx("daisu-tab", active && "is-active")}
      onClick={onActivate}
      onMouseDown={handleMouseDown}
      role="tab"
      aria-selected={active}
      title={tab.path ?? tab.name}
    >
      {tab.pinned && (
        <Pin
          size={12}
          aria-label="Pinned"
          className="daisu-tab-pin"
          style={{ transform: "rotate(-45deg)" }}
        />
      )}
      <span className={`daisu-tab-name${gitClass}`}>{tab.name}</span>
      {dirty && <span aria-hidden="true" className="daisu-tab-dirty">●</span>}
      <button
        type="button"
        aria-label="Close"
        className="daisu-tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X size={12} />
      </button>
      {closestEdge === "left" && <span aria-hidden="true" className="daisu-tab-edge-left" />}
      {closestEdge === "right" && <span aria-hidden="true" className="daisu-tab-edge-right" />}
    </div>
  );
}
