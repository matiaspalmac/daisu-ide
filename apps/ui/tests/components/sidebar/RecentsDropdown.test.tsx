import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecentsDropdown } from "../../../src/components/sidebar/RecentsDropdown";

describe("<RecentsDropdown>", () => {
  it("opens folder picker when Open Folder… clicked", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <RecentsDropdown
        recents={[]}
        onOpenFolderPicker={onOpen}
        onPickRecent={vi.fn()}
        onClearRecents={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /recent/i }));
    await user.click(screen.getByText(/open folder…/i));
    expect(onOpen).toHaveBeenCalled();
  });

  it("renders recents and triggers onPickRecent on click", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    const recents = [
      { path: "C:\\demo", name: "demo", openedAt: 1 },
      { path: "C:\\other", name: "other", openedAt: 2 },
    ];
    render(
      <RecentsDropdown
        recents={recents}
        onOpenFolderPicker={vi.fn()}
        onPickRecent={onPick}
        onClearRecents={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /recent/i }));
    await user.click(screen.getByText("demo"));
    expect(onPick).toHaveBeenCalledWith("C:\\demo");
  });

  it("renders empty state when no recents", async () => {
    const user = userEvent.setup();
    render(
      <RecentsDropdown
        recents={[]}
        onOpenFolderPicker={vi.fn()}
        onPickRecent={vi.fn()}
        onClearRecents={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /recent/i }));
    expect(screen.getByText(/no recent workspaces/i)).toBeInTheDocument();
  });
});
