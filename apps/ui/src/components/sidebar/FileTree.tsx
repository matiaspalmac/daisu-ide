import { useMemo, useRef, type JSX } from "react";
import { Tree, type MoveHandler, type RenameHandler, type TreeApi } from "react-arborist";
import { useWorkspace } from "../../stores/workspaceStore";
import type { FileEntry } from "../../api/tauri";
import { Node } from "./Node";

export function FileTree(): JSX.Element | null {
  const rootPath = useWorkspace((s) => s.rootPath);
  const tree = useWorkspace((s) => s.tree);
  const childrenIndex = useWorkspace((s) => s.childrenIndex);
  const expanded = useWorkspace((s) => s.expanded);
  const renameAction = useWorkspace((s) => s.rename);
  const moveNodes = useWorkspace((s) => s.moveNodes);
  const toggleExpand = useWorkspace((s) => s.toggleExpand);
  const selectNode = useWorkspace((s) => s.selectNode);

  const treeRef = useRef<TreeApi<FileEntry> | null>(null);

  const data = useMemo(() => {
    if (!rootPath) return [];
    const build = (
      path: string
    ): FileEntry & { children?: (FileEntry & { children?: unknown })[] } => {
      const entry = tree.get(path);
      const safeEntry: FileEntry =
        entry ?? { path, name: path, kind: "dir", size: null, mtimeMs: null };
      const children = childrenIndex.get(path);
      if (safeEntry.kind === "dir" && children) {
        return {
          ...safeEntry,
          children: children.map(build) as never,
        };
      }
      return safeEntry;
    };
    const rootChildren = childrenIndex.get(rootPath) ?? [];
    return rootChildren.map(build);
  }, [rootPath, tree, childrenIndex]);

  const onRename: RenameHandler<FileEntry> = ({ id, name }) => {
    void renameAction(id, name);
  };

  const onMove: MoveHandler<FileEntry> = ({ dragIds, parentId }) => {
    if (!parentId) return;
    void moveNodes(dragIds, parentId);
  };

  if (!rootPath || data.length === 0) {
    return null;
  }

  return (
    <div className="daisu-filetree" role="tree" aria-label="Workspace file tree">
      <Tree<FileEntry>
        ref={treeRef}
        data={data}
        idAccessor="path"
        rowHeight={22}
        indent={16}
        width="100%"
        height={600}
        onRename={onRename}
        onMove={onMove}
        onActivate={(node) => selectNode(node.id, "single")}
        onToggle={(id) => toggleExpand(id)}
        openByDefault={false}
        initialOpenState={Object.fromEntries([...expanded].map((p) => [p, true]))}
      >
        {Node as never}
      </Tree>
    </div>
  );
}
