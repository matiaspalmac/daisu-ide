import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Tab } from "../../../src/components/tabs/Tab";
import type { OpenTab } from "../../../src/stores/tabsStore";

const baseTab: OpenTab = {
  id: "t1",
  path: "C:\\demo\\App.tsx",
  name: "App.tsx",
  language: "typescript",
  content: "x",
  savedContent: "x",
  cursorState: null,
  pinned: false,
  untitledIndex: null,
  eol: "LF",
  encoding: "UTF-8",
};

describe("<Tab>", () => {
  it("renders the tab name", () => {
    render(
      <Tab tab={baseTab} active={false} onActivate={vi.fn()} onClose={vi.fn()} closestEdge={null} />,
    );
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
  });

  it("shows dirty dot when content !== savedContent", () => {
    const tab = { ...baseTab, content: "y" };
    const { container } = render(
      <Tab tab={tab} active={true} onActivate={vi.fn()} onClose={vi.fn()} closestEdge={null} />,
    );
    expect(container.querySelector(".daisu-tab-dirty")).not.toBeNull();
  });

  it("renders pin glyph when pinned", () => {
    const tab = { ...baseTab, pinned: true };
    render(
      <Tab tab={tab} active={false} onActivate={vi.fn()} onClose={vi.fn()} closestEdge={null} />,
    );
    expect(screen.getByLabelText("Pinned")).toBeInTheDocument();
  });

  it("calls onActivate when clicked", () => {
    const onActivate = vi.fn();
    render(
      <Tab tab={baseTab} active={false} onActivate={onActivate} onClose={vi.fn()} closestEdge={null} />,
    );
    fireEvent.click(screen.getByText("App.tsx"));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("middle-click triggers onClose", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Tab tab={baseTab} active={false} onActivate={vi.fn()} onClose={onClose} closestEdge={null} />,
    );
    const root = container.querySelector(".daisu-tab")!;
    fireEvent.mouseDown(root, { button: 1 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("close X click triggers onClose", () => {
    const onClose = vi.fn();
    render(
      <Tab tab={baseTab} active={true} onActivate={vi.fn()} onClose={onClose} closestEdge={null} />,
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders left edge indicator when closestEdge=left", () => {
    const { container } = render(
      <Tab tab={baseTab} active={false} onActivate={vi.fn()} onClose={vi.fn()} closestEdge="left" />,
    );
    expect(container.querySelector(".daisu-tab-edge-left")).not.toBeNull();
  });

  it("renders right edge indicator when closestEdge=right", () => {
    const { container } = render(
      <Tab tab={baseTab} active={false} onActivate={vi.fn()} onClose={vi.fn()} closestEdge="right" />,
    );
    expect(container.querySelector(".daisu-tab-edge-right")).not.toBeNull();
  });
});
