import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Node } from "../../../src/components/sidebar/Node";
import type { FileEntry } from "../../../src/api/tauri";

const mkNode = (
  overrides: Partial<{
    name: string;
    isLeaf: boolean;
    isOpen: boolean;
    isSelected: boolean;
    isEditing: boolean;
    data: FileEntry;
    toggle: () => void;
    reset: () => void;
    submit: (v: string) => void;
  }> = {}
) => ({
  name: overrides.name ?? "App.tsx",
  isLeaf: overrides.isLeaf ?? true,
  isOpen: overrides.isOpen ?? false,
  isSelected: overrides.isSelected ?? false,
  isEditing: overrides.isEditing ?? false,
  toggle: overrides.toggle ?? vi.fn(),
  reset: overrides.reset ?? vi.fn(),
  submit: overrides.submit ?? vi.fn(),
  data: overrides.data ?? {
    path: "C:\\demo\\App.tsx",
    name: overrides.name ?? "App.tsx",
    kind: "file" as const,
    size: 0,
    mtimeMs: null,
  },
});

describe("<Node>", () => {
  it("renders file name and a leaf icon", () => {
    const node = mkNode();
    const { container } = render(
      <Node
        node={node as never}
        style={{}}
        tree={{} as never}
        dragHandle={undefined}
      />
    );
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
    // FileIcon resolves the leaf icon by extension. Assert the .tsx-specific
    // React-blue color (#61DAFB) is set so a regression to the gray fallback
    // (#888) would fail.
    const svg = container.querySelector(".daisu-tree-row svg");
    expect(svg).toBeInTheDocument();
    // Phosphor sets `color` via inline style; fall back to color/stroke
    // attributes for forward-compat in case the lib changes.
    const styleColor = (svg as SVGElement | null)?.style.color ?? null;
    const inkColor =
      styleColor ||
      svg?.getAttribute("color") ||
      svg?.getAttribute("stroke") ||
      svg?.getAttribute("fill");
    expect(inkColor?.toLowerCase().replace(/\s/g, "")).toMatch(
      /#61dafb|rgb\(97,218,251\)/,
    );
  });

  it("renders chevron and folder icon for non-leaf", () => {
    const node = mkNode({
      name: "src",
      isLeaf: false,
      data: {
        path: "C:\\demo\\src",
        name: "src",
        kind: "dir",
        size: null,
        mtimeMs: null,
      },
    });
    render(
      <Node node={node as never} style={{}} tree={{} as never} dragHandle={undefined} />
    );
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByLabelText("Folder")).toBeInTheDocument();
  });

  it("shows an input when editing", () => {
    const node = mkNode({ isEditing: true });
    render(
      <Node node={node as never} style={{}} tree={{} as never} dragHandle={undefined} />
    );
    expect(screen.getByDisplayValue("App.tsx")).toBeInTheDocument();
  });

  it("applies selected class when isSelected", () => {
    const node = mkNode({ isSelected: true });
    const { container } = render(
      <Node node={node as never} style={{}} tree={{} as never} dragHandle={undefined} />
    );
    const row = container.querySelector(".daisu-tree-row");
    expect(row?.className).toContain("is-selected");
  });
});
