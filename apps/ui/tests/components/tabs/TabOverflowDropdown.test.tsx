import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TabOverflowDropdown } from "../../../src/components/tabs/TabOverflowDropdown";

describe("<TabOverflowDropdown>", () => {
  it("renders count in trigger label", () => {
    render(
      <TabOverflowDropdown
        hidden={[
          { id: "t1", name: "App.tsx", dirty: false, pinned: false },
          { id: "t2", name: "main.rs", dirty: true, pinned: false },
          { id: "t3", name: "lib.rs", dirty: false, pinned: false },
        ]}
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /\+3/ })).toBeInTheDocument();
  });

  it("does not render when hidden is empty", () => {
    const { container } = render(
      <TabOverflowDropdown hidden={[]} onPick={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("opens and lists hidden tab names", async () => {
    const user = userEvent.setup();
    render(
      <TabOverflowDropdown
        hidden={[
          { id: "t1", name: "App.tsx", dirty: false, pinned: false },
          { id: "t2", name: "main.rs", dirty: true, pinned: false },
        ]}
        onPick={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /\+2/ }));
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
    expect(screen.getByText("main.rs")).toBeInTheDocument();
  });

  it("calls onPick with selected tab id", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(
      <TabOverflowDropdown
        hidden={[
          { id: "t1", name: "App.tsx", dirty: false, pinned: false },
          { id: "t2", name: "main.rs", dirty: false, pinned: false },
        ]}
        onPick={onPick}
      />,
    );
    await user.click(screen.getByRole("button", { name: /\+2/ }));
    await user.click(screen.getByText("main.rs"));
    expect(onPick).toHaveBeenCalledWith("t2");
  });
});
