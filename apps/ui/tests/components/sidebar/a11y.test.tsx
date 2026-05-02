import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "../../../src/components/sidebar/EmptyState";
import { RecentsDropdown } from "../../../src/components/sidebar/RecentsDropdown";

describe("sidebar a11y", () => {
  it("EmptyState no-folder has no axe violations", async () => {
    const { container } = render(
      <EmptyState variant="no-folder" onOpenFolder={vi.fn()} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("EmptyState walking has no axe violations", async () => {
    const { container } = render(<EmptyState variant="walking" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("EmptyState read-error has no axe violations", async () => {
    const { container } = render(
      <EmptyState
        variant="read-error"
        message="Permission denied"
        onRetry={vi.fn()}
        onOpenDifferent={vi.fn()}
      />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("RecentsDropdown trigger has no axe violations", async () => {
    const { container } = render(
      <RecentsDropdown
        recents={[]}
        onOpenFolderPicker={vi.fn()}
        onPickRecent={vi.fn()}
        onClearRecents={vi.fn()}
      />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
