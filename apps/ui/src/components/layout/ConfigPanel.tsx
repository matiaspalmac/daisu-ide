import type { JSX } from "react";
import { CaretLeft, Cloud, Cpu } from "@phosphor-icons/react";
import { useUI } from "../../stores/uiStore";
import { useSettings } from "../../stores/settingsStore";

type ProviderMode = "cloud" | "local";
type ProviderId = "gemini" | "openai" | "anthropic" | "lmstudio" | "ollama";

interface ProviderSpec {
  id: ProviderId;
  label: string;
  helper: string;
  placeholder?: string;
}

const CLOUD_PROVIDERS: ProviderSpec[] = [
  {
    id: "gemini",
    label: "Gemini",
    helper: "Obtén tu API key desde Google AI Studio",
    placeholder: "AIza...",
  },
  {
    id: "openai",
    label: "OpenAI",
    helper: "Obtén tu API key desde platform.openai.com",
    placeholder: "sk-...",
  },
  {
    id: "anthropic",
    label: "Claude",
    helper: "Obtén tu API key desde console.anthropic.com",
    placeholder: "sk-ant-...",
  },
];

const LOCAL_PROVIDERS: ProviderSpec[] = [
  {
    id: "lmstudio",
    label: "LM Studio",
    helper: "Asegúrate que LM Studio está corriendo en localhost:1234",
  },
  {
    id: "ollama",
    label: "Ollama",
    helper: "Asegúrate que Ollama está corriendo en localhost:11434",
  },
];

export function ConfigPanel(): JSX.Element {
  const setRightPanelMode = useUI((s) => s.setRightPanelMode);
  const pushToast = useUI((s) => s.pushToast);
  const settings = useSettings((s) => s.settings);
  const setSetting = useSettings((s) => s.set);

  const ai = settings.aiProvider;
  const providers = ai.mode === "cloud" ? CLOUD_PROVIDERS : LOCAL_PROVIDERS;
  const selected =
    providers.find((p) => p.id === ai.id) ?? providers[0]!;

  const setMode = (mode: ProviderMode): void => {
    const next = mode === "cloud" ? CLOUD_PROVIDERS[0]! : LOCAL_PROVIDERS[0]!;
    void setSetting("aiProvider", { mode, id: next.id, apiKey: "" });
  };

  const setProvider = (id: ProviderId): void => {
    void setSetting("aiProvider", { ...ai, id, apiKey: "" });
  };

  const setApiKey = (apiKey: string): void => {
    void setSetting("aiProvider", { ...ai, apiKey });
  };

  const save = (): void => {
    pushToast({
      message: "Configuración guardada (validación API en M3)",
      level: "success",
    });
  };

  return (
    <aside
      className="h-full flex flex-col bg-[var(--bg-panel)] border-l border-[var(--border-subtle)]"
      aria-label="AI provider configuration"
    >
      <header className="h-9 px-3 flex items-center justify-between border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-[0.08em] text-[var(--fg-secondary)]">
        <span>Configuración</span>
        <button
          type="button"
          aria-label="Volver al chat"
          title="Volver al chat"
          onClick={() => setRightPanelMode("chat")}
          className="w-6 h-6 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] rounded-[var(--radius-sm)]"
        >
          <CaretLeft size={14} />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Mode segmented */}
        <div className="grid grid-cols-2 gap-2">
          {(["cloud", "local"] as const).map((m) => {
            const active = ai.mode === m;
            const Icon = m === "cloud" ? Cloud : Cpu;
            const subtitle =
              m === "cloud" ? "Gemini, OpenAI, Claude" : "LM Studio, Ollama";
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={active}
                className={
                  "rounded-[var(--radius-md)] border p-3 flex flex-col items-start gap-1 text-left transition-colors " +
                  (active
                    ? "bg-[var(--accent-soft)] border-[var(--accent)] shadow-[var(--glow-cyan-sm)]"
                    : "bg-[var(--bg-elevated)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]")
                }
              >
                <span
                  className={
                    "flex items-center gap-2 text-sm " +
                    (active
                      ? "text-[var(--accent)]"
                      : "text-[var(--fg-primary)]")
                  }
                >
                  <Icon size={14} />
                  {m === "cloud" ? "Cloud" : "Local"}
                </span>
                <span className="text-[11px] text-[var(--fg-muted)]">{subtitle}</span>
              </button>
            );
          })}
        </div>

        {/* Provider select */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="ai-provider"
            className="text-xs uppercase tracking-wider text-[var(--fg-muted)]"
          >
            Proveedor
          </label>
          <select
            id="ai-provider"
            value={ai.id}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
            className="daisu-select w-full bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--fg-primary)] focus-visible:border-[var(--accent)]"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* API key (cloud only) */}
        {ai.mode === "cloud" && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="ai-key"
              className="text-xs uppercase tracking-wider text-[var(--fg-muted)]"
            >
              API Key
            </label>
            <input
              id="ai-key"
              type="password"
              value={ai.apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={selected.placeholder ?? "API key"}
              className="daisu-input w-full bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--fg-primary)] font-mono"
            />
            <p className="text-[11px] text-[var(--fg-muted)] mt-1">
              {selected.helper}
            </p>
          </div>
        )}

        {ai.mode === "local" && (
          <p className="text-xs text-[var(--fg-muted)]">{selected.helper}</p>
        )}

        <button
          type="button"
          onClick={save}
          className="self-start mt-2 inline-flex items-center justify-center h-8 px-4 rounded-[var(--radius-md)] bg-[var(--warn)] text-[var(--fg-inverse)] hover:bg-[var(--warn-bright)] shadow-[var(--glow-orange-sm)] text-sm font-medium"
        >
          Guardar Configuración
        </button>

        <p className="text-[11px] text-[var(--fg-muted)] mt-auto pt-4 border-t border-[var(--border-subtle)]">
          Limitación M2: API key en almacenamiento local plano. M3 migra a OS
          keychain via Tauri secure storage.
        </p>
      </div>
    </aside>
  );
}
