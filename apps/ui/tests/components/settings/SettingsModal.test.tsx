import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

vi.mock("../../../src/api/tauri", () => ({
  listBundledThemesCmd: vi.fn(async () => [
    { id: "daisu-dark", name: "Daisu Dark", kind: "dark" },
  ]),
  readThemeJsonCmd: vi.fn(async () => ({
    name: "Daisu Dark",
    type: "dark",
    colors: { "editor.background": "#1f1f1f" },
    tokenColors: [],
  })),
}));

import { SettingsModal } from "../../../src/components/settings/SettingsModal";
import { useUI } from "../../../src/stores/uiStore";

beforeEach(() => {
  useUI.setState({ settingsModalOpen: false } as never);
});
afterEach(() => undefined);

describe("<SettingsModal>", () => {
  it("does not render when settingsModalOpen=false", () => {
    render(<SettingsModal />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders when settingsModalOpen=true with first category active", () => {
    useUI.setState({ settingsModalOpen: true } as never);
    render(<SettingsModal />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
  });

  it("sidebar nav switches the active category", () => {
    useUI.setState({ settingsModalOpen: true } as never);
    render(<SettingsModal />);
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(screen.getByRole("heading", { name: "Editor" })).toBeInTheDocument();
  });

  it("close button sets settingsModalOpen=false", () => {
    useUI.setState({ settingsModalOpen: true } as never);
    render(<SettingsModal />);
    fireEvent.click(screen.getByLabelText(/cerrar configuración/i));
    expect(useUI.getState().settingsModalOpen).toBe(false);
  });
});
