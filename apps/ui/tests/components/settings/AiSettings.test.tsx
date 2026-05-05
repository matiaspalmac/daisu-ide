import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("../../../src/lib/ollama-detect", () => ({
  probeOllama: vi.fn(async () => ({ reachable: false, models: [] })),
  pickBestModel: vi.fn((models: string[], current: string) => current),
}));

vi.mock("../../../src/lib/agent-tools", () => ({
  listAllowlist: vi.fn(async () => []),
  clearAllowlist: vi.fn(async () => 0),
}));

vi.mock("../../../src/lib/agent-index", () => ({
  indexRebuild: vi.fn(),
  indexStatus: vi.fn(async () => null),
}));

import { AiSettings } from "../../../src/components/settings/categories/AiSettings";
import { useSettings } from "../../../src/stores/settingsStore";

const PROVIDER_LIST = [
  {
    id: "ollama",
    name: "Ollama (local)",
    requiresKey: false,
    hasKey: true,
    supportsTools: true,
    supportsParallelTools: false,
    implemented: true,
    defaultModel: "qwen3-coder",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    requiresKey: true,
    hasKey: false,
    supportsTools: true,
    supportsParallelTools: true,
    implemented: true,
    defaultModel: "claude-sonnet-4-6",
  },
  {
    id: "openai",
    name: "OpenAI",
    requiresKey: true,
    hasKey: false,
    supportsTools: true,
    supportsParallelTools: true,
    implemented: true,
    defaultModel: "gpt-5.5",
  },
];

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "agent_provider_list") return PROVIDER_LIST;
    if (cmd === "agent_provider_models") {
      return {
        models: [
          { id: "qwen3-coder", supportsTools: true },
          { id: "qwen3-72b", supportsTools: true },
        ],
        defaultModel: "qwen3-coder",
      };
    }
    return undefined;
  });
  useSettings.setState((s) => ({
    ...s,
    settings: {
      ...s.settings,
      aiProvider: {
        ...s.settings.aiProvider,
        id: "ollama",
        model: "qwen3-coder",
      },
    },
  }) as never);
});

afterEach(() => undefined);

describe("<AiSettings> fetch-models flow", () => {
  it("calls the backend and exposes the live catalog when the user clicks Fetch models", async () => {
    render(<AiSettings />);
    await waitFor(() => expect(screen.getByText("Ollama (local)")).toBeTruthy());

    const button = screen.getByRole("button", { name: /fetch models|cargar modelos|モデルを取得/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "agent_provider_models",
        expect.objectContaining({
          req: expect.objectContaining({ provider: "ollama" }),
        }),
      );
    });
    await waitFor(() =>
      expect(screen.getByText(/2 models available|2 modelos disponibles|2 件のモデル/i)).toBeTruthy(),
    );
  });

  it("renders an error message when the backend rejects the fetch", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "agent_provider_list") return PROVIDER_LIST;
      if (cmd === "agent_provider_models") {
        throw new Error("network down");
      }
      return undefined;
    });

    render(<AiSettings />);
    await waitFor(() => expect(screen.getByText("Ollama (local)")).toBeTruthy());

    const button = screen.getByRole("button", { name: /fetch models|cargar modelos|モデルを取得/i });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("network down");
  });

  it("disables Fetch models when the selected cloud provider lacks an API key", async () => {
    useSettings.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        aiProvider: {
          ...s.settings.aiProvider,
          id: "anthropic",
          model: "claude-sonnet-4-6",
        },
      },
    }) as never);

    render(<AiSettings />);
    await waitFor(() => expect(screen.getByText("Anthropic Claude")).toBeTruthy());

    const button = screen.getByRole("button", { name: /fetch models|cargar modelos|モデルを取得/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses the backend's defaultModel when switching providers", async () => {
    render(<AiSettings />);
    await waitFor(() => expect(screen.getByText("Anthropic Claude")).toBeTruthy());

    const radio = screen.getByRole("radio", { name: /Anthropic Claude/ });
    fireEvent.click(radio);

    await waitFor(() => {
      const ai = useSettings.getState().settings.aiProvider;
      expect(ai.id).toBe("anthropic");
      expect(ai.model).toBe("claude-sonnet-4-6");
    });
  });
});
