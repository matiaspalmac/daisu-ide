import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "../../../src/components/sidebar/EmptyState";

describe("<EmptyState>", () => {
  it("no-folder variant renders Open Folder action", () => {
    const onOpen = vi.fn();
    render(<EmptyState variant="no-folder" onOpenFolder={onOpen} />);
    expect(screen.getByText("No folder open")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("walking variant renders spinner label", () => {
    render(<EmptyState variant="walking" />);
    expect(screen.getByText("Reading folder…")).toBeInTheDocument();
  });

  it("empty-folder variant renders New File / New Folder actions", () => {
    const onNewFile = vi.fn();
    const onNewFolder = vi.fn();
    render(
      <EmptyState
        variant="empty-folder"
        onNewFile={onNewFile}
        onNewFolder={onNewFolder}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /new file/i }));
    expect(onNewFile).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /new folder/i }));
    expect(onNewFolder).toHaveBeenCalled();
  });

  it("read-error variant renders message and Retry", () => {
    const onRetry = vi.fn();
    render(
      <EmptyState
        variant="read-error"
        message="Permission denied: C:\\foo"
        onRetry={onRetry}
      />
    );
    expect(screen.getByText("Couldn't read folder")).toBeInTheDocument();
    expect(screen.getByText(/Permission denied/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
