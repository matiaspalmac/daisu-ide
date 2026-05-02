import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    { id: "daisu-light", name: "Daisu Light", kind: "light" },
  ]),
  readThemeJsonCmd: vi.fn(async (id: string) => ({
    name: id,
    type: id === "daisu-dark" ? "dark" : "light",
    colors: { "editor.background": id === "daisu-dark" ? "#1f1f1f" : "#ffffff" },
    tokenColors: [],
  })),
}));

import { ThemePicker } from "../../../src/components/settings/ThemePicker";
import { useThemes } from "../../../src/stores/themesStore";
import { useSettings } from "../../../src/stores/settingsStore";

beforeEach(() => {
  useThemes.getState().reset();
});
afterEach(() => undefined);

describe("<ThemePicker>", () => {
  it("loads and lists bundled themes", async () => {
    render(<ThemePicker />);
    await waitFor(() => {
      expect(screen.getByText("Daisu Dark")).toBeInTheDocument();
      expect(screen.getByText("Daisu Light")).toBeInTheDocument();
    });
  });

  it("highlights the active theme", async () => {
    useSettings.setState((s) => ({
      settings: {
        ...s.settings,
        themes: { ...s.settings.themes, activeThemeId: "daisu-light" },
      },
    }));
    const { container } = render(<ThemePicker />);
    await waitFor(() => {
      expect(container.querySelector(".daisu-theme-card.is-active")).not.toBeNull();
    });
    const active = container.querySelector(".daisu-theme-card.is-active")!;
    expect(active.textContent).toContain("Daisu Light");
  });

  it("clicking a theme sets activeThemeId", async () => {
    useSettings.setState((s) => ({
      settings: {
        ...s.settings,
        themes: { ...s.settings.themes, activeThemeId: "daisu-dark" },
      },
    }));
    render(<ThemePicker />);
    await waitFor(() => screen.getByText("Daisu Light"));
    fireEvent.click(screen.getByText("Daisu Light"));
    await waitFor(() => {
      expect(useSettings.getState().settings.themes.activeThemeId).toBe("daisu-light");
    });
  });
});
