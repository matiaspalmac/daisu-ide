import { useEffect, useState, type JSX } from "react";
import {
  CheckCircle,
  WarningCircle,
  Robot,
  ArrowClockwise,
  CaretDown,
  CaretRight,
} from "@phosphor-icons/react";
import { useSettings } from "../../../stores/settingsStore";
import { useWorkspace } from "../../../stores/workspaceStore";
import {
  type AgentProviderId,
  type AgentProviderInfo,
  listProviders,
  setProviderKey,
  clearProviderKey,
  testProvider,
} from "../../../lib/agent";
import {
  listAllowlist,
  clearAllowlist,
  type AllowlistEntry,
} from "../../../lib/agent-tools";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset the in-flight key draft and any test/save status when the user
  // switches provider — otherwise an unsaved secret could be written under
  // the wrong provider id.
  useEffect(() => {
    setKeyDraft("");
    setKeyError(null);
    setTestResult(null);
  }, [ai.id]);

  async function refresh(): Promise<void> {
    setLoading(true);
    setLoadError(null);
    try {
      setProviders(await listProviders());
    } catch (e) {
      setLoadError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
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
    setKeyError(null);
    try {
      await setProviderKey(ai.id as AgentProviderId, keyDraft.trim());
      setKeyDraft("");
      await refresh();
    } catch (e) {
      setKeyError(String((e as Error).message ?? e));
    } finally {
      setSavingKey(false);
    }
  }

  async function handleClearKey(): Promise<void> {
    setKeyError(null);
    try {
      await clearProviderKey(ai.id as AgentProviderId);
      await refresh();
    } catch (e) {
      setKeyError(String((e as Error).message ?? e));
    }
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
        {loading && (
          <p className="daisu-field-desc">Cargando proveedores…</p>
        )}
        {!loading && loadError && (
          <div className="daisu-test-status is-fail" role="alert">
            <WarningCircle size={14} weight="fill" />
            No se pudieron cargar los proveedores: {loadError}
            <button
              type="button"
              className="daisu-btn ml-2"
              onClick={() => void refresh()}
            >
              <ArrowClockwise size={12} /> Reintentar
            </button>
          </div>
        )}
        {!loading && !loadError &&
          providers.map((p) => (
            <label
              key={p.id}
              className={`daisu-radio-row${ai.id === p.id ? " is-active" : ""}${
                p.implemented ? "" : " is-disabled"
              }`}
            >
              <input
                type="radio"
                name="ai-provider"
                checked={ai.id === p.id}
                disabled={!p.implemented}
                onChange={() => void handleSelect(p.id)}
              />
              <div className="daisu-radio-row-body">
                <div className="daisu-radio-row-title">
                  <Robot size={14} />
                  {p.name}
                  {!p.implemented && (
                    <span className="daisu-pill-muted">próximamente</span>
                  )}
                  {p.implemented && p.requiresKey && p.hasKey && (
                    <CheckCircle
                      size={12}
                      weight="fill"
                      className="text-success"
                    />
                  )}
                  {p.implemented && p.requiresKey && !p.hasKey && (
                    <WarningCircle
                      size={12}
                      weight="fill"
                      className="text-warn"
                    />
                  )}
                </div>
                <p className="daisu-radio-row-desc">
                  {p.implemented
                    ? p.requiresKey
                      ? p.hasKey
                        ? "API key configurada"
                        : "Requiere API key"
                      : "Local · sin clave"
                    : "Implementación en M3 Phase 1+"}
                  {p.implemented && p.supportsTools ? " · tools" : ""}
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
          <p className="daisu-field-desc" id="ai-key-desc">
            Se almacena en el keychain del sistema operativo (Windows
            Credential Manager). Nunca se escribe en disco en texto plano.
          </p>
          <div className="daisu-field-row">
            <label htmlFor="ai-key-input" className="sr-only">
              API key para {current.name}
            </label>
            <input
              id="ai-key-input"
              type="password"
              className="daisu-input daisu-input-mono"
              placeholder={current.hasKey ? "•••••••• (configurada)" : "sk-..."}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              autoComplete="off"
              aria-describedby="ai-key-desc"
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
          {keyError && (
            <p className="daisu-test-status is-fail" role="alert">
              <WarningCircle size={12} weight="fill" />
              {keyError}
            </p>
          )}
        </>
      )}

      <PermisosSection />

      <h3 className="daisu-settings-section-title">Test de conexión</h3>
      <div className="daisu-field-row">
        <button
          type="button"
          className="daisu-btn daisu-btn-primary"
          disabled={
            testing ||
            (current?.implemented === false) ||
            (current?.requiresKey === true && !current.hasKey)
          }
          onClick={() => void handleTest()}
        >
          {testing ? "Probando…" : "Probar conexión"}
        </button>
        <span
          aria-live="polite"
          aria-atomic="true"
          className={
            testResult
              ? `daisu-test-status ${testResult.ok ? "is-ok" : "is-fail"}`
              : "daisu-test-status"
          }
        >
          {testResult && (
            <>
              {testResult.ok ? (
                <CheckCircle size={14} weight="fill" />
              ) : (
                <WarningCircle size={14} weight="fill" />
              )}
              {testResult.message}
              {testResult.latencyMs != null &&
                ` · ${testResult.latencyMs}ms`}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function PermisosSection(): JSX.Element {
  const workspacePath = useWorkspace((s) => s.rootPath);
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<AllowlistEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    if (!workspacePath) return;
    setLoading(true);
    setError(null);
    try {
      setEntries(await listAllowlist(workspacePath));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (expanded) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, workspacePath]);

  async function handleClearAll(): Promise<void> {
    if (!workspacePath) return;
    try {
      await clearAllowlist(workspacePath);
      await refresh();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }

  return (
    <>
      <h3 className="daisu-settings-section-title">
        <button
          type="button"
          className="daisu-btn-ghost flex items-center gap-1"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
          Permisos del agente
        </button>
      </h3>
      {expanded && (
        <div className="daisu-field">
          <div className="daisu-field-text">
            <p className="daisu-field-desc">
              Lista de herramientas con decisiones persistidas para el
              workspace actual. Borra para volver a pedir confirmación.
            </p>
          </div>
          {!workspacePath && (
            <p className="daisu-field-desc">
              Abre un workspace para ver permisos.
            </p>
          )}
          {workspacePath && (
            <>
              {loading && <p className="daisu-field-desc">Cargando…</p>}
              {error && (
                <p className="daisu-test-status is-fail" role="alert">
                  <WarningCircle size={12} weight="fill" />
                  {error}
                </p>
              )}
              {!loading && entries.length === 0 && (
                <p className="daisu-field-desc">Sin entradas todavía.</p>
              )}
              {entries.length > 0 && (
                <ul className="text-xs space-y-1 mt-2">
                  {entries.map((e) => (
                    <li
                      key={`${e.tool_name}:${e.scope_glob}`}
                      className="font-mono flex items-center gap-2"
                    >
                      <span
                        className={
                          e.decision === "allow"
                            ? "text-success"
                            : "text-warn"
                        }
                      >
                        {e.decision}
                      </span>
                      <span>{e.tool_name}</span>
                      <span className="text-[var(--fg-muted)]">
                        {e.scope_glob}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="daisu-field-row mt-2">
                <button
                  type="button"
                  className="daisu-btn"
                  onClick={() => void refresh()}
                >
                  Refrescar
                </button>
                <button
                  type="button"
                  className="daisu-btn"
                  disabled={entries.length === 0}
                  onClick={() => void handleClearAll()}
                >
                  Borrar todo
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
