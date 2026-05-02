import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CloseConfirmModal } from "../../../src/components/tabs/CloseConfirmModal";

describe("<CloseConfirmModal>", () => {
  it("does not render when pending is null", () => {
    render(<CloseConfirmModal pending={null} tabsByName={new Map()} onResolve={vi.fn()} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("single variant shows tab name in title", () => {
    render(
      <CloseConfirmModal
        pending={{ ids: ["t1"], mode: "single" }}
        tabsByName={new Map([["t1", "App.tsx"]])}
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByText(/Save changes to App.tsx\?/)).toBeInTheDocument();
  });

  it("batch variant shows count in title and lists names", () => {
    render(
      <CloseConfirmModal
        pending={{ ids: ["t1", "t2", "t3"], mode: "batch" }}
        tabsByName={new Map([
          ["t1", "App.tsx"],
          ["t2", "main.rs"],
          ["t3", "lib.rs"],
        ])}
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByText(/Save changes to 3 files\?/)).toBeInTheDocument();
    expect(screen.getByText(/App.tsx/)).toBeInTheDocument();
    expect(screen.getByText(/main.rs/)).toBeInTheDocument();
  });

  it("Save calls onResolve with save", () => {
    const onResolve = vi.fn();
    render(
      <CloseConfirmModal
        pending={{ ids: ["t1"], mode: "single" }}
        tabsByName={new Map([["t1", "App.tsx"]])}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    expect(onResolve).toHaveBeenCalledWith("save");
  });

  it("Don't Save calls onResolve with discard", () => {
    const onResolve = vi.fn();
    render(
      <CloseConfirmModal
        pending={{ ids: ["t1"], mode: "single" }}
        tabsByName={new Map([["t1", "App.tsx"]])}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Don't Save/ }));
    expect(onResolve).toHaveBeenCalledWith("discard");
  });

  it("Cancel calls onResolve with cancel", () => {
    const onResolve = vi.fn();
    render(
      <CloseConfirmModal
        pending={{ ids: ["t1"], mode: "single" }}
        tabsByName={new Map([["t1", "App.tsx"]])}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onResolve).toHaveBeenCalledWith("cancel");
  });

  it("batch with > 8 dirty truncates list", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const map = new Map(ids.map((id, i) => [id, `file${i}.ts`]));
    render(
      <CloseConfirmModal
        pending={{ ids, mode: "batch" }}
        tabsByName={map}
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByText(/and 4 more/)).toBeInTheDocument();
  });
});
