import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabBar } from "../../../src/components/tabs/TabBar";
import { useTabs } from "../../../src/stores/tabsStore";

vi.mock("../../../src/api/tauri", () => ({
  openFile: vi.fn(),
  saveFile: vi.fn(),
  saveFileAsViaDialog: vi.fn(),
  saveSessionCmd: vi.fn(async () => undefined),
  loadSessionCmd: vi.fn(async () => null),
  deleteSessionCmd: vi.fn(async () => undefined),
}));
vi.mock("../../../src/lib/monaco-models", () => ({
  disposeModel: vi.fn(),
  disposeAllModels: vi.fn(),
}));

beforeEach(() => useTabs.getState().reset());
afterEach(() => vi.clearAllMocks());

describe("<TabBar>", () => {
  it("renders only the new-tab button when no tabs", () => {
    const { container } = render(<TabBar />);
    const bar = container.querySelector(".daisu-tabbar");
    expect(bar).not.toBeNull();
    // Only the trailing "+" button should be present.
    expect(bar?.querySelector("[data-tab-id]")).toBeNull();
    expect(bar?.querySelector('button[aria-label="Nuevo archivo"]')).not.toBeNull();
  });

  it("renders one tab per OpenTab", () => {
    const tabs = useTabs.getState();
    tabs.newTab();
    tabs.newTab();
    render(<TabBar />);
    expect(screen.getByText("Untitled-1")).toBeInTheDocument();
    expect(screen.getByText("Untitled-2")).toBeInTheDocument();
  });

  it("pinned tabs render before unpinned", () => {
    const tabs = useTabs.getState();
    tabs.newTab();
    tabs.newTab();
    const idTwo = useTabs.getState().tabs[1]!.id;
    tabs.pin(idTwo);
    const { container } = render(<TabBar />);
    // Skip the leading virtual "Inicio" tab rendered by TabBar.
    const rendered = Array.from(container.querySelectorAll(".daisu-tab"))
      .map((n) => (n.textContent ?? "").trim())
      .filter((t) => !t.startsWith("Inicio"));
    expect(rendered[0]?.startsWith("Untitled-2")).toBe(true);
    expect(rendered[1]?.startsWith("Untitled-1")).toBe(true);
  });
});
