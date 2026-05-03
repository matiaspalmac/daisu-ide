import type { CSSProperties, JSX } from "react";
import type { NodeApi, TreeApi } from "react-arborist";
import { ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import clsx from "clsx";
import type { FileEntry } from "../../api/tauri";
import { useGit } from "../../stores/gitStore";

interface Props {
  node: NodeApi<FileEntry>;
  style: CSSProperties;
  tree: TreeApi<FileEntry>;
  dragHandle?: ((el: HTMLDivElement | null) => void) | undefined;
}

const STATUS_BADGE: Record<string, string> = {
  Modified: "M",
  Untracked: "U",
  Conflict: "C",
  Staged: "S",
};

export function Node({ node, style, dragHandle }: Props): JSX.Element {
  const Icon = node.isLeaf ? File : node.isOpen ? FolderOpen : Folder;
  const iconLabel = node.isLeaf ? "File" : "Folder";
  const status = useGit((s) => s.status(node.data.path));
  const tintClass = status ? `daisu-git-${status.toLowerCase()}` : "";
  const badge = status ? STATUS_BADGE[status] : null;

  return (
    <div
      ref={dragHandle}
      style={style}
      className={clsx(
        "daisu-tree-row",
        tintClass,
        node.isSelected && "is-selected",
        node.isEditing && "is-editing",
      )}
      onDoubleClick={() => {
        if (!node.isLeaf) node.toggle();
      }}
    >
      {!node.isLeaf && (
        <span
          className={clsx("daisu-tree-chevron", node.isOpen && "is-open")}
          aria-hidden="true"
        >
          <ChevronRight size={14} />
        </span>
      )}
      {node.isLeaf && <span className="daisu-tree-chevron-spacer" aria-hidden="true" />}
      <Icon size={14} aria-label={iconLabel} className="daisu-tree-icon" />
      {node.isEditing ? (
        <input
          autoFocus
          className="daisu-tree-edit"
          defaultValue={node.data.name}
          onBlur={() => node.reset()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              node.submit((e.target as HTMLInputElement).value);
            } else if (e.key === "Escape") {
              node.reset();
            }
          }}
        />
      ) : (
        <span className="daisu-tree-name">{node.data.name}</span>
      )}
      {badge && (
        <span
          className="daisu-git-badge"
          aria-label={`Git status ${status}`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}
