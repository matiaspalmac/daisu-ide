import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "../../../src/components/sidebar/FileTree";
import { useWorkspace } from "../../../src/stores/workspaceStore";

vi.mock("../../../src/api/tauri", () => ({
  openWorkspaceCmd: vi.fn(),
  closeWorkspaceCmd: vi.fn(),
  listDirCmd: vi.fn(async () => []),
  createFileCmd: vi.fn(),
  createDirCmd: vi.fn(),
  renamePathCmd: vi.fn(),
  deleteToTrashCmd: vi.fn(),
  restoreFromTrashCmd: vi.fn(),
  copyPathCmd: vi.fn(),
}));
vi.mock("../../../src/lib/persistent-store", () => ({
  loadWorkspacePersistence: vi.fn(async () => ({ recents: [], expandedPersisted: {} })),
  saveWorkspacePersistence: vi.fn(async () => undefined),
}));

beforeEach(() => {
  useWorkspace.getState().reset();
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 240,
  });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("<FileTree>", () => {
  it("renders nothing when rootPath is null", () => {
    const { container } = render(<FileTree />);
    expect(container.querySelector(".daisu-filetree")).toBeNull();
  });

  it("renders root children when present", () => {
    const ws = useWorkspace.getState();
    ws._setRoot("C:\\demo", "abc");
    ws._injectNode({
      path: "C:\\demo\\App.tsx",
      name: "App.tsx",
      kind: "file",
      size: 0,
      mtimeMs: null,
    });
    ws._setChildren("C:\\demo", ["C:\\demo\\App.tsx"]);
    render(<FileTree />);
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
  });
});
