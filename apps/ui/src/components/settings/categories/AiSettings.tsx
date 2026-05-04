import { useEffect, useState, type JSX } from "react";
import { CheckCircle, WarningCircle, Robot } from "@phosphor-icons/react";
import { useSettings } from "../../../stores/settingsStore";
import {
  type AgentProviderId,
  type AgentProviderInfo,
  listProviders,
  setProviderKey,
  clearProviderKey,
  testProvider,
} from "../../../lib/agent";

const PROVIDER_DEFAULT_MODELS: Record<AgentProviderId, string> = {
  ollama: "llama3.2",
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
  lmstudio: "local-model",
};

interface TestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export function AiSettings(): JSX.Element {
  const ai = useSettings((s) => s.settings.aiProvider);
  const setSetting = useSettings((s) => s.set);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
  const [keyDraft, setKeyDraft] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    try {
      setProviders(await listProviders());
    } catch (e) {
      console.error("listProviders", e);
    }
  }

  const current = providers.find((p) => p.id === ai.id);

  async function handleSelect(id: AgentProviderId): Promise<void> {
    setTestResult(null);
    await setSetting("aiProvider", {
      id,
      mode: id === "ollama" || id === "lmstudio" ? "local" : "cloud",
      model: PROVIDER_DEFAULT_MODELS[id],
    });
  }

  async function handleSaveKey(): Promise<void> {
    if (!keyDraft.trim()) return;
    setSavingKey(true);
    try {
      await setProviderKey(ai.id as AgentProviderId, keyDraft.trim());
      setKeyDraft("");
      await refresh();
    } finally {
      setSavingKey(false);
    }
  }

  async function handleClearKey(): Promise<void> {
    await clearProviderKey(ai.id as AgentProviderId);
    await refresh();
  }

  async function handleTest(): Promise<void> {
    setTestResult(null);
    setTesting(true);
    try {
      const baseUrl =
        ai.id === "ollama"
          ? ai.ollamaBaseUrl
          : ai.id === "lmstudio"
            ? ai.lmstudioBaseUrl
            : undefined;
      const res = await testProvider({
        provider: ai.id as AgentProviderId,
        model: ai.model,
        ...(baseUrl ? { baseUrl } : {}),
      });
      setTestResult({
        ok: true,
        message: `Modelo ${res.model} respondió: "${res.sample.slice(0, 80)}"`,
        latencyMs: res.latencyMs,
      });
    } catch (e) {
      setTestResult({
        ok: false,
        message: String((e as Error).message ?? e),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">
        <span className="daisu-glyph mr-2" aria-hidden="true">話</span>
        Agente · IA
      </h2>
      <p className="daisu-settings-section-desc">
        Daisu se conecta a un proveedor LLM para chat, completados y agentes.
        Por defecto usa Ollama local (privacidad, sin clave). Cambia a un
        proveedor cloud si querés Claude, GPT o Gemini.
      </p>

      <h3 className="daisu-settings-section-title">Proveedor</h3>
      <div className="daisu-radio-list">
        {providers.length === 0 && (
          <p className="daisu-field-desc">Cargando proveedores…</p>
        )}
        {providers.map((p) => (
          <label
            key={p.id}
            className={`daisu-radio-row${ai.id === p.id ? " is-active" : ""}`}
          >
            <input
              type="radio"
              name="ai-provider"
              checked={ai.id === p.id}
              onChange={() => void handleSelect(p.id)}
            />
            <div className="daisu-radio-row-body">
              <div className="daisu-radio-row-title">
                <Robot size={14} />
                {p.name}
                {p.requiresKey && p.hasKey && (
                  <CheckCircle size={12} weight="fill" className="text-success" />
                )}
                {p.requiresKey && !p.hasKey && (
                  <WarningCircle size={12} weight="fill" className="text-warn" />
                )}
              </div>
              <p className="daisu-radio-row-desc">
                {p.requiresKey
                  ? p.hasKey
                    ? "API key configurada"
                    : "Requiere API key"
                  : "Local · sin clave"}
                {p.supportsTools ? " · tools" : ""}
              </p>
            </div>
          </label>
        ))}
      </div>

      <h3 className="daisu-settings-section-title">Modelo</h3>
      <div className="daisu-field">
        <div className="daisu-field-text">
          <label className="daisu-field-label" htmlFor="ai-model">
            Identificador del modelo
          </label>
          <p className="daisu-field-desc">
            Ej: <code>llama3.2</code>, <code>claude-haiku-4-5-20251001</code>,
            <code>gpt-4o-mini</code>. Verificá el ID exacto en la documentación
            del proveedor.
          </p>
        </div>
        <input
          id="ai-model"
          type="text"
          className="daisu-input daisu-input-mono"
          value={ai.model}
          onChange={(e) =>
            void setSetting("aiProvider", { model: e.target.value })
          }
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {(ai.id === "ollama" || ai.id === "lmstudio") && (
        <div className="daisu-field">
          <div className="daisu-field-text">
            <label className="daisu-field-label" htmlFor="ai-base-url">
              URL base
            </label>
            <p className="daisu-field-desc">
              Endpoint del servidor local. Ollama default{" "}
              <code>http://localhost:11434</code>; LM Studio default{" "}
              <code>http://localhost:1234/v1</code>.
            </p>
          </div>
          <input
            id="ai-base-url"
            type="text"
            className="daisu-input daisu-input-mono"
            value={ai.id === "ollama" ? ai.ollamaBaseUrl : ai.lmstudioBaseUrl}
            onChange={(e) =>
              void setSetting(
                "aiProvider",
                ai.id === "ollama"
                  ? { ollamaBaseUrl: e.target.value }
                  : { lmstudioBaseUrl: e.target.value },
              )
            }
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      )}

      {current?.requiresKey && (
        <>
          <h3 className="daisu-settings-section-title">API key</h3>
          <p className="daisu-field-desc">
            Se almacena en el keychain del sistema operativo (Windows
            Credential Manager). Nunca se escribe en disco en texto plano.
          </p>
          <div className="daisu-field-row">
            <input
              type="password"
              className="daisu-input daisu-input-mono"
              placeholder={current.hasKey ? "•••••••• (configurada)" : "sk-..."}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              className="daisu-btn daisu-btn-primary"
              disabled={savingKey || !keyDraft.trim()}
              onClick={() => void handleSaveKey()}
            >
              {savingKey ? "Guardando…" : "Guardar"}
            </button>
            {current.hasKey && (
              <button
                type="button"
                className="daisu-btn"
                onClick={() => void handleClearKey()}
              >
                Borrar
              </button>
            )}
          </div>
        </>
      )}

      <h3 className="daisu-settings-section-title">Test de conexión</h3>
      <div className="daisu-field-row">
        <button
          type="button"
          className="daisu-btn daisu-btn-primary"
          disabled={testing || (current?.requiresKey === true && !current.hasKey)}
          onClick={() => void handleTest()}
        >
          {testing ? "Probando…" : "Probar conexión"}
        </button>
        {testResult && (
          <span
            className={`daisu-test-status ${testResult.ok ? "is-ok" : "is-fail"}`}
          >
            {testResult.ok ? (
              <CheckCircle size={14} weight="fill" />
            ) : (
              <WarningCircle size={14} weight="fill" />
            )}
            {testResult.message}
            {testResult.latencyMs != null && ` · ${testResult.latencyMs}ms`}
          </span>
        )}
      </div>
    </div>
  );
}
