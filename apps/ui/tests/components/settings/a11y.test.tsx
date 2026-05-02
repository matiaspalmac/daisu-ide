import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";

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
  readThemeJsonCmd: vi.fn(async () => ({
    name: "Daisu Dark",
    type: "dark",
    colors: { "editor.background": "#1f1f1f" },
    tokenColors: [],
  })),
  exportSettingsCmd: vi.fn(async () => undefined),
  importSettingsCmd: vi.fn(async () => ({})),
}));

import { SettingsModal } from "../../../src/components/settings/SettingsModal";
import { ThemePicker } from "../../../src/components/settings/ThemePicker";
import { KeybindingField } from "../../../src/components/settings/controls/KeybindingField";
import { useUI } from "../../../src/stores/uiStore";

describe("settings a11y", () => {
  it("SettingsModal has no axe violations", async () => {
    useUI.setState({ settingsModalOpen: true } as never);
    const { container } = render(<SettingsModal />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("ThemePicker has no axe violations", async () => {
    const { container } = render(<ThemePicker />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("KeybindingField has no axe violations", async () => {
    const { container } = render(
      <KeybindingField
        actionId="tabs.close"
        actionLabel="Close tab"
        defaultBinding="$mod+w"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
