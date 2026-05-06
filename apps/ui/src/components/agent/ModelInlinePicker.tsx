import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { Cpu } from "@phosphor-icons/react";
import { useSettings } from "../../stores/settingsStore";
import {
  type AgentProviderId,
  type AgentProviderInfo,
  type ModelInfo,
  listProviders,
  listProviderModels,
} from "../../lib/agent";
import { probeOllama } from "../../lib/ollama-detect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

/**
 * Compact provider+model picker rendered in the agent panel header so
 * users can switch model without opening Settings. Mirrors the behaviour
 * of the AiSettings page: provider radio → model dropdown with the live
 * catalog merged with installed Ollama tags. Live changes write straight
 * to the existing settings store, so the next sendMessage picks them up.
 */
export function ModelInlinePicker(): JSX.Element {
  const { t } = useTranslation();
  const ai = useSettings((s) => s.settings.aiProvider);
  const setSetting = useSettings((s) => s.set);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
  const [providerModels, setProviderModels] = useState<ModelInfo[]>([]);
  const [installedModels, setInstalledModels] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listProviders()
      .then((rows) => {
        if (!cancelled) setProviders(rows);
      })
      .catch(() => {
        /* surface in settings, header stays minimal */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load Ollama installed models (read-only HTTP probe — no key needed).
  useEffect(() => {
    if (ai.id !== "ollama") {
      setInstalledModels([]);
      return;
    }
    let cancelled = false;
    void probeOllama(ai.ollamaBaseUrl).then((p) => {
      if (cancelled) return;
      setInstalledModels(p.models);
    });
    return () => {
      cancelled = true;
    };
  }, [ai.id, ai.ollamaBaseUrl]);

  // Auto-fetch live catalog when a provider that supports it is active
  // and (for cloud providers) a key is configured.
  useEffect(() => {
    const info = providers.find((p) => p.id === ai.id);
    if (!info?.implemented) return;
    if (info.requiresKey && !info.hasKey) return;
    let cancelled = false;
    const requestedBaseUrl =
      ai.id === "ollama"
        ? ai.ollamaBaseUrl
        : ai.id === "lmstudio"
          ? ai.lmstudioBaseUrl
          : undefined;
    void listProviderModels(ai.id as AgentProviderId, requestedBaseUrl)
      .then((res) => {
        if (cancelled) return;
        setProviderModels(res.models);
      })
      .catch(() => {
        if (!cancelled) setProviderModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ai.id, ai.ollamaBaseUrl, ai.lmstudioBaseUrl, providers]);

  const choices = new Map<string, string>();
  for (const m of providerModels) {
    choices.set(m.id, m.displayName ?? m.id);
  }
  if (ai.id === "ollama") {
    for (const m of installedModels) {
      if (!choices.has(m)) choices.set(m, m);
    }
  }
  const items = Array.from(choices.entries());

  async function handleProviderChange(id: AgentProviderId): Promise<void> {
    const info = providers.find((p) => p.id === id);
    const fallback = info?.defaultModel ?? "";
    await setSetting("aiProvider", {
      id,
      mode: id === "ollama" || id === "lmstudio" ? "local" : "cloud",
      model: fallback,
    });
  }

  async function handleModelChange(model: string): Promise<void> {
    await setSetting("aiProvider", { model });
  }

  return (
    <div className="daisu-agent-modelpicker" aria-label={t("chat.modelPickerLabel")}>
      <Cpu size={12} className="text-[var(--fg-muted)]" />
      <Select
        value={ai.id}
        onValueChange={(v) => void handleProviderChange(v as AgentProviderId)}
      >
        <SelectTrigger
          className="daisu-agent-modelpicker-trigger"
          aria-label={t("chat.providerPickerLabel")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {providers
            .filter((p) => p.implemented)
            .map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {items.length > 0 && (
        <Select
          {...(ai.model ? { value: ai.model } : {})}
          onValueChange={(v) => void handleModelChange(v)}
        >
          <SelectTrigger
            className="daisu-agent-modelpicker-trigger"
            aria-label={t("chat.modelPickerLabel")}
          >
            <SelectValue placeholder="…" />
          </SelectTrigger>
          <SelectContent>
            {items.map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
