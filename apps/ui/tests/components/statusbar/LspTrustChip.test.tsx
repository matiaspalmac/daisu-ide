import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { LspTrustChip } from "../../../src/components/statusbar/LspTrustChip";
import { useWorkspace } from "../../../src/stores/workspaceStore";

beforeEach(() => {
  invokeMock.mockReset();
  useWorkspace.setState((s) => ({ ...s, rootPath: "/tmp/workspace" }) as never);
});
afterEach(() => undefined);

describe("<LspTrustChip>", () => {
  it("renders nothing when no workspace is open", () => {
    useWorkspace.setState((s) => ({ ...s, rootPath: null }) as never);
    invokeMock.mockResolvedValue({ trusted: false });
    const { container } = render(<LspTrustChip />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when workspace is already trusted", async () => {
    invokeMock.mockResolvedValue({ trusted: true });
    const { container } = render(<LspTrustChip />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "lsp_workspace_is_trusted",
        expect.anything(),
      );
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders a chip when the workspace is untrusted and opens dialog on click", async () => {
    invokeMock.mockResolvedValueOnce({ trusted: false });
    render(<LspTrustChip />);
    const chip = await screen.findByRole("button", {
      name: /trust workspace|confiar en workspace|ワークスペースを信頼/i,
    });
    expect(chip).toBeTruthy();
    fireEvent.click(chip);
    await screen.findByRole("alertdialog");
  });

  it("hides the chip after trust is granted", async () => {
    invokeMock
      .mockResolvedValueOnce({ trusted: false })
      .mockResolvedValueOnce({ trusted: true });
    render(<LspTrustChip />);
    const chip = await screen.findByRole("button", {
      name: /trust workspace|confiar en workspace|ワークスペースを信頼/i,
    });
    fireEvent.click(chip);
    const confirmBtn = await screen.findByRole("button", {
      name: /^trust$|^confiar$|^信頼$/i,
    });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "lsp_workspace_trust",
        expect.anything(),
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: /trust workspace|confiar en workspace|ワークスペースを信頼/i,
        }),
      ).toBeNull();
    });
  });
});
