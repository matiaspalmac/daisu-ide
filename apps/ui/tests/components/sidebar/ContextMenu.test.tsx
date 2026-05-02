import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TreeContextMenu } from "../../../src/components/sidebar/ContextMenu";

describe("<TreeContextMenu>", () => {
  it("renders New File / New Folder for empty-area variant", async () => {
    const user = userEvent.setup();
    render(
      <TreeContextMenu
        target="empty-area"
        selectionSize={0}
        clipboardPresent={false}
        onAction={vi.fn()}
      >
        <div data-testid="zone" style={{ width: 100, height: 100 }}>
          right-click here
        </div>
      </TreeContextMenu>
    );
    await user.pointer({ target: screen.getByTestId("zone"), keys: "[MouseRight]" });
    expect(screen.getByText("New File")).toBeInTheDocument();
    expect(screen.getByText("New Folder")).toBeInTheDocument();
  });

  it("disables Rename when selection size is not 1", async () => {
    const user = userEvent.setup();
    render(
      <TreeContextMenu
        target="node"
        selectionSize={2}
        clipboardPresent={false}
        onAction={vi.fn()}
      >
        <div data-testid="zone" style={{ width: 100, height: 100 }}>
          row
        </div>
      </TreeContextMenu>
    );
    await user.pointer({ target: screen.getByTestId("zone"), keys: "[MouseRight]" });
    const renameItem = screen.getByText("Rename").closest("[role='menuitem']");
    expect(renameItem?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("hides Paste when clipboard is empty", async () => {
    const user = userEvent.setup();
    render(
      <TreeContextMenu
        target="node"
        selectionSize={1}
        clipboardPresent={false}
        onAction={vi.fn()}
      >
        <div data-testid="zone" style={{ width: 100, height: 100 }}>
          row
        </div>
      </TreeContextMenu>
    );
    await user.pointer({ target: screen.getByTestId("zone"), keys: "[MouseRight]" });
    const pasteItem = screen.getByText("Paste").closest("[role='menuitem']");
    expect(pasteItem?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("calls onAction with the chosen action key", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <TreeContextMenu
        target="node"
        selectionSize={1}
        clipboardPresent={false}
        onAction={onAction}
      >
        <div data-testid="zone" style={{ width: 100, height: 100 }}>
          row
        </div>
      </TreeContextMenu>
    );
    await user.pointer({ target: screen.getByTestId("zone"), keys: "[MouseRight]" });
    await user.click(screen.getByText("Rename"));
    expect(onAction).toHaveBeenCalledWith("rename");
  });
});
