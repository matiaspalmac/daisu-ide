import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";
import { CloseConfirmModal } from "../../../src/components/tabs/CloseConfirmModal";
import { TabOverflowDropdown } from "../../../src/components/tabs/TabOverflowDropdown";

describe("tabs a11y", () => {
  it("CloseConfirmModal single has no axe violations", async () => {
    const { container } = render(
      <CloseConfirmModal
        pending={{ ids: ["t1"], mode: "single" }}
        tabsByName={new Map([["t1", "App.tsx"]])}
        onResolve={vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("CloseConfirmModal batch has no axe violations", async () => {
    const { container } = render(
      <CloseConfirmModal
        pending={{ ids: ["t1", "t2"], mode: "batch" }}
        tabsByName={new Map([
          ["t1", "App.tsx"],
          ["t2", "main.rs"],
        ])}
        onResolve={vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("TabOverflowDropdown trigger has no axe violations", async () => {
    const { container } = render(
      <TabOverflowDropdown
        hidden={[
          { id: "t1", name: "App.tsx", dirty: false, pinned: false },
        ]}
        onPick={vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
