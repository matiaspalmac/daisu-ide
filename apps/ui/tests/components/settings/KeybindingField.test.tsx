import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

import { KeybindingField } from "../../../src/components/settings/controls/KeybindingField";
import { useSettings } from "../../../src/stores/settingsStore";
import { useUI } from "../../../src/stores/uiStore";

beforeEach(() => {
  vi.useFakeTimers();
  useSettings.setState((s) => ({
    settings: { ...s.settings, keybindings: {} },
  }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("<KeybindingField>", () => {
  it("renders the default binding when no override", () => {
    render(
      <KeybindingField
        actionId="tabs.close"
        actionLabel="Close tab"
        defaultBinding="$mod+w"
      />,
    );
    expect(screen.getByText(/Ctrl\+W/i)).toBeInTheDocument();
  });

  it("shows override when user has set one", () => {
    useSettings.setState((s) => ({
      settings: { ...s.settings, keybindings: { "tabs.close": "$mod+q" } },
    }));
    render(
      <KeybindingField
        actionId="tabs.close"
        actionLabel="Close tab"
        defaultBinding="$mod+w"
      />,
    );
    expect(screen.getByText(/Ctrl\+Q/i)).toBeInTheDocument();
  });

  it("enters record mode on edit click", () => {
    render(
      <KeybindingField
        actionId="tabs.close"
        actionLabel="Close tab"
        defaultBinding="$mod+w"
      />,
    );
    fireEvent.click(screen.getByLabelText(/edit/i));
    expect(screen.getByText(/Press shortcut/i)).toBeInTheDocument();
  });

  it("ignores bare modifier presses", async () => {
    render(
      <KeybindingField
        actionId="tabs.close"
        actionLabel="Close tab"
        defaultBinding="$mod+w"
      />,
    );
    fireEvent.click(screen.getByLabelText(/edit/i));
    await act(async () => {
      fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    });
    expect(useSettings.getState().settings.keybindings["tabs.close"]).toBeUndefined();
  });

  it("captures ctrl+q and saves to settings", async () => {
    render(
      <KeybindingField
        actionId="tabs.close"
        actionLabel="Close tab"
        defaultBinding="$mod+w"
      />,
    );
    fireEvent.click(screen.getByLabelText(/edit/i));
    await act(async () => {
      fireEvent.keyDown(window, { key: "q", ctrlKey: true });
    });
    expect(useSettings.getState().settings.keybindings["tabs.close"]).toBe("$mod+q");
  });

  it("cancels recording after 5s timeout", () => {
    render(
      <KeybindingField
        actionId="tabs.close"
        actionLabel="Close tab"
        defaultBinding="$mod+w"
      />,
    );
    fireEvent.click(screen.getByLabelText(/edit/i));
    expect(screen.getByText(/Press shortcut/i)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5500);
    });
    expect(screen.queryByText(/Press shortcut/i)).toBeNull();
  });

  it("reset button restores default", async () => {
    useSettings.setState((s) => ({
      settings: { ...s.settings, keybindings: { "tabs.close": "$mod+q" } },
    }));
    render(
      <KeybindingField
        actionId="tabs.close"
        actionLabel="Close tab"
        defaultBinding="$mod+w"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/reset/i));
    });
    expect(
      useSettings.getState().settings.keybindings["tabs.close"],
    ).toBeUndefined();
  });

  it("conflict toast fires when combo already bound elsewhere", async () => {
    const pushToast = vi.fn();
    useUI.setState({ pushToast } as never);
    useSettings.setState((s) => ({
      settings: { ...s.settings, keybindings: { "file.save": "$mod+s" } },
    }));
    render(
      <KeybindingField
        actionId="tabs.close"
        actionLabel="Close tab"
        defaultBinding="$mod+w"
      />,
    );
    fireEvent.click(screen.getByLabelText(/edit/i));
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });
    expect(pushToast).toHaveBeenCalled();
    expect(useSettings.getState().settings.keybindings["tabs.close"]).toBe("$mod+s");
  });
});
