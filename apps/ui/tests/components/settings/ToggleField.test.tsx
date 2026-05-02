import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

import { ToggleField } from "../../../src/components/settings/controls/ToggleField";
import { useSettings } from "../../../src/stores/settingsStore";

describe("<ToggleField>", () => {
  it("reads boolean value from settings", () => {
    useSettings.setState((s) => ({
      settings: { ...s.settings, editor: { ...s.settings.editor, minimap: true } },
    }));
    render(<ToggleField category="editor" field="minimap" label="Minimap" />);
    const input = screen.getByRole("switch") as HTMLInputElement;
    expect(input.getAttribute("aria-checked")).toBe("true");
  });

  it("toggles via setState on click", () => {
    useSettings.setState((s) => ({
      settings: { ...s.settings, editor: { ...s.settings.editor, minimap: false } },
    }));
    render(<ToggleField category="editor" field="minimap" label="Minimap" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(useSettings.getState().settings.editor.minimap).toBe(true);
  });

  it("renders the label", () => {
    render(<ToggleField category="editor" field="minimap" label="Show minimap" />);
    expect(screen.getByText("Show minimap")).toBeInTheDocument();
  });
});
