import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Tree, type MoveHandler, type RenameHandler, type TreeApi } from "react-arborist";
import { useWorkspace } from "../../stores/workspaceStore";
import { useTabs } from "../../stores/tabsStore";
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
  const openTab = useTabs((s) => s.openTab);

  const treeRef = useRef<TreeApi<FileEntry> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    obs.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => obs.disconnect();
  }, []);

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
    <div
      ref={containerRef}
      className="daisu-filetree h-full w-full"
      role="tree"
      aria-label="Workspace file tree"
    >
      <Tree<FileEntry>
          ref={treeRef}
          data={data}
          idAccessor="path"
          rowHeight={22}
          indent={16}
          width={size.w || 240}
          height={size.h || 400}
          onRename={onRename}
          onMove={onMove}
          onActivate={(node) => {
            // Selection only — file open is wired in Node.onClick to give
            // single-click open semantics. Avoids duplicate-tab race when
            // arborist's onActivate (dblclick/Enter) also fired openTab.
            selectNode(node.id, "single");
          }}
          onToggle={(id) => toggleExpand(id)}
          openByDefault={false}
          initialOpenState={Object.fromEntries([...expanded].map((p) => [p, true]))}
        >
          {Node as never}
        </Tree>
    </div>
  );
}
