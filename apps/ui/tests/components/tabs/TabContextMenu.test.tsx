import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TabContextMenu } from "../../../src/components/tabs/TabContextMenu";

describe("<TabContextMenu>", () => {
  it("renders Close, Close Others, Close All items", async () => {
    const user = userEvent.setup();
    render(
      <TabContextMenu
        tabId="t1"
        pinned={false}
        hasPath={true}
        totalTabs={3}
        onAction={vi.fn()}
      >
        <div data-testid="zone" style={{ width: 100, height: 32 }}>row</div>
      </TabContextMenu>,
    );
    await user.pointer({ target: screen.getByTestId("zone"), keys: "[MouseRight]" });
    expect(screen.getByText("Close")).toBeInTheDocument();
    expect(screen.getByText("Close Others")).toBeInTheDocument();
    expect(screen.getByText("Close All")).toBeInTheDocument();
  });

  it("disables Close Others when totalTabs is 1", async () => {
    const user = userEvent.setup();
    render(
      <TabContextMenu
        tabId="t1"
        pinned={false}
        hasPath={true}
        totalTabs={1}
        onAction={vi.fn()}
      >
        <div data-testid="zone" style={{ width: 100, height: 32 }}>row</div>
      </TabContextMenu>,
    );
    await user.pointer({ target: screen.getByTestId("zone"), keys: "[MouseRight]" });
    const item = screen.getByText("Close Others").closest("[role='menuitem']");
    expect(item?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("shows Pin when not pinned", async () => {
    const user = userEvent.setup();
    render(
      <TabContextMenu
        tabId="t1"
        pinned={false}
        hasPath={true}
        totalTabs={2}
        onAction={vi.fn()}
      >
        <div data-testid="zone" style={{ width: 100, height: 32 }}>row</div>
      </TabContextMenu>,
    );
    await user.pointer({ target: screen.getByTestId("zone"), keys: "[MouseRight]" });
    expect(screen.getByText("Pin")).toBeInTheDocument();
    expect(screen.queryByText("Unpin")).toBeNull();
  });

  it("shows Unpin when pinned", async () => {
    const user = userEvent.setup();
    render(
      <TabContextMenu
        tabId="t1"
        pinned={true}
        hasPath={true}
        totalTabs={2}
        onAction={vi.fn()}
      >
        <div data-testid="zone" style={{ width: 100, height: 32 }}>row</div>
      </TabContextMenu>,
    );
    await user.pointer({ target: screen.getByTestId("zone"), keys: "[MouseRight]" });
    expect(screen.getByText("Unpin")).toBeInTheDocument();
  });

  it("disables Copy Path when hasPath is false (untitled)", async () => {
    const user = userEvent.setup();
    render(
      <TabContextMenu
        tabId="t1"
        pinned={false}
        hasPath={false}
        totalTabs={2}
        onAction={vi.fn()}
      >
        <div data-testid="zone" style={{ width: 100, height: 32 }}>row</div>
      </TabContextMenu>,
    );
    await user.pointer({ target: screen.getByTestId("zone"), keys: "[MouseRight]" });
    const item = screen.getByText("Copy Path").closest("[role='menuitem']");
    expect(item?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("calls onAction with the chosen key", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <TabContextMenu
        tabId="t1"
        pinned={false}
        hasPath={true}
        totalTabs={2}
        onAction={onAction}
      >
        <div data-testid="zone" style={{ width: 100, height: 32 }}>row</div>
      </TabContextMenu>,
    );
    await user.pointer({ target: screen.getByTestId("zone"), keys: "[MouseRight]" });
    await user.click(screen.getByText("Close"));
    expect(onAction).toHaveBeenCalledWith("close");
  });
});
