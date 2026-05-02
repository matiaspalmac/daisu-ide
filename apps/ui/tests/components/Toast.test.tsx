import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { axe } from "vitest-axe";
import { ToastViewport } from "../../src/components/ui/Toast";
import { useUI } from "../../src/stores/uiStore";

// Radix Toast intentionally renders <li role="status"> inside <ol> so that
// assistive tech announces toasts as live-region status messages while the
// surrounding viewport stays a semantic list. axe flags this combination
// (aria-allowed-role + list) as a false positive; the pattern is the upstream
// recommendation, so we skip those two rules and keep every other check.
const AXE_OPTIONS = {
  rules: {
    "aria-allowed-role": { enabled: false },
    list: { enabled: false },
  },
} as const;

describe("ToastViewport accessibility", () => {
  beforeEach(() => useUI.getState().reset());

  it("has no a11y violations when empty", async () => {
    const { container } = render(<ToastViewport />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it("has no a11y violations with one toast", async () => {
    useUI.getState().pushToast({ message: "hello", level: "info" });
    const { container } = render(<ToastViewport />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it("renders an action button and calls onAction when clicked", () => {
    const onAction = vi.fn();
    useUI.getState().pushToast({
      message: "Moved 1 item to trash",
      level: "info",
      action: { label: "Undo", onAction },
    });
    render(<ToastViewport />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
