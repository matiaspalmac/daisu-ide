import type { CSSProperties, JSX } from "react";
import type { NodeApi, TreeApi } from "react-arborist";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import clsx from "clsx";
import type { FileEntry } from "../../api/tauri";
import { useGit } from "../../stores/gitStore";
import { useTabs } from "../../stores/tabsStore";
import { FileIcon } from "@/lib/file-icon";
import { cn } from "@/lib/cn";

interface Props {
  node: NodeApi<FileEntry>;
  style: CSSProperties;
  tree: TreeApi<FileEntry>;
  dragHandle?: ((el: HTMLDivElement | null) => void) | undefined;
}

export function Node({ node, style, dragHandle }: Props): JSX.Element {
  const status = useGit((s) => s.status(node.data.path));
  const tintClass = status ? `daisu-git-${status.toLowerCase()}` : "";
  const showConflictDot = status === "Conflict";

  return (
    <div
      ref={dragHandle}
      style={style}
      className={cn(
        "daisu-tree-row",
        tintClass,
        node.isEditing && "is-editing",
        node.isSelected
          ? "is-selected bg-[var(--accent-soft)] text-[var(--accent)] border-l-2 border-[var(--accent)]"
          : "hover:bg-[var(--accent-soft)]/40",
      )}
      onClick={() => {
        node.select();
        if (node.isLeaf) {
          void useTabs.getState().openTab(node.data.path);
        } else {
          node.toggle();
        }
      }}
    >
      {!node.isLeaf && (
        <span
          className={clsx("daisu-tree-chevron", node.isOpen && "is-open")}
          aria-hidden="true"
        >
          <ChevronRight size={14} strokeWidth={1.5} />
        </span>
      )}
      {node.isLeaf && <span className="daisu-tree-chevron-spacer" aria-hidden="true" />}
      {node.isLeaf ? (
        <FileIcon name={node.data.name} size={14} />
      ) : node.isOpen ? (
        <FolderOpen size={14} aria-label="Folder" className="daisu-tree-icon text-[var(--fg-muted)]" />
      ) : (
        <Folder size={14} aria-label="Folder" className="daisu-tree-icon text-[var(--fg-muted)]" />
      )}
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
      {showConflictDot && (
        <span
          className="ml-auto mr-1 w-1 h-1 rounded-full bg-[var(--danger)] shadow-[0_0_4px_var(--danger)]"
          aria-label={`Git status ${status}`}
        />
      )}
    </div>
  );
}
