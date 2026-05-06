import { useEffect, useState, type JSX } from "react";
import { Trans, useTranslation } from "react-i18next";
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
  type ModelInfo,
  listProviders,
  listProviderModels,
  setProviderKey,
  clearProviderKey,
  testProvider,
} from "../../../lib/agent";
import {
  indexRebuild,
  indexStatus,
  type IndexStatus,
} from "../../../lib/agent-index";
import { probeOllama, pickBestModel } from "../../../lib/ollama-detect";
import {
  listAllowlist,
  clearAllowlist,
  type AllowlistEntry,
} from "../../../lib/agent-tools";
import { translateError } from "../../../lib/error-translate";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";

interface TestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export function AiSettings(): JSX.Element {
  const { t } = useTranslation();
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
  const rootPath = useWorkspace((s) => s.rootPath);
  const [idxStatus, setIdxStatus] = useState<IndexStatus | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexMsg, setReindexMsg] = useState<string | null>(null);
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [providerModels, setProviderModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    if (ai.id !== "ollama") {
      setInstalledModels([]);
      return;
    }
    let cancelled = false;
    void probeOllama(ai.ollamaBaseUrl).then((p) => {
      if (cancelled) return;
      setInstalledModels(p.models);
      // If the configured model isn't installed locally, repoint to the
      // best available one. Without this the test-connection POST hits
      // /api/chat with a model Ollama returns 404 for.
      if (p.reachable && p.models.length > 0 && !p.models.includes(ai.model)) {
        const best = pickBestModel(p.models, ai.model);
        if (best && best !== ai.model) {
          void setSetting("aiProvider", { model: best });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ai.id, ai.ollamaBaseUrl, ai.model, setSetting]);

  async function handleDetect(): Promise<void> {
    setDetecting(true);
    setDetectMsg(null);
    const probe = await probeOllama(ai.ollamaBaseUrl, { force: true });
    if (!probe.reachable) {
      setDetectMsg(t("ai.detectUnreachable", { url: ai.ollamaBaseUrl }));
      setDetecting(false);
      return;
    }
    setInstalledModels(probe.models);
    if (probe.models.length === 0) {
      setDetectMsg(t("ai.detectNoModels"));
      setDetecting(false);
      return;
    }
    const best = pickBestModel(probe.models, ai.model);
    if (best !== ai.model) {
      await setSetting("aiProvider", { model: best });
    }
    setDetectMsg(t("ai.detectFound", { count: probe.models.length, model: best }));
    setDetecting(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!rootPath) {
      setIdxStatus(null);
      return;
    }
    indexStatus(rootPath)
      .then(setIdxStatus)
      .catch(() => setIdxStatus(null));
  }, [rootPath]);

  async function handleReindex(): Promise<void> {
    if (!rootPath) return;
    setReindexing(true);
    setReindexMsg(null);
    try {
      const res = await indexRebuild(rootPath);
      setReindexMsg(
        t("ai.indexedToast", { count: res.indexed, ms: res.durationMs }),
      );
      const next = await indexStatus(rootPath);
      setIdxStatus(next);
    } catch (e) {
      setReindexMsg(`${t("palette.symbols.errorPrefix")}: ${String((e as Error).message ?? e)}`);
    } finally {
      setReindexing(false);
    }
  }

  useEffect(() => {
    setKeyDraft("");
    setKeyError(null);
    setTestResult(null);
    setProviderModels([]);
    setModelsError(null);
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

  async function fetchModels(): Promise<void> {
    // Pin the provider+url at call time. If the user toggles provider
    // or edits a base URL while the request is in flight, the late
    // result no longer matches `ai.*` and we discard it instead of
    // overwriting whatever the user moved on to.
    const requestedProvider = ai.id;
    const requestedBaseUrl =
      ai.id === "ollama"
        ? ai.ollamaBaseUrl
        : ai.id === "lmstudio"
          ? ai.lmstudioBaseUrl
          : undefined;
    setLoadingModels(true);
    setModelsError(null);
    setProviderModels([]);
    try {
      const res = await listProviderModels(
        requestedProvider as AgentProviderId,
        requestedBaseUrl,
      );
      const stillRelevant =
        ai.id === requestedProvider &&
        (requestedProvider !== "ollama" ||
          ai.ollamaBaseUrl === requestedBaseUrl) &&
        (requestedProvider !== "lmstudio" ||
          ai.lmstudioBaseUrl === requestedBaseUrl);
      if (!stillRelevant) return;
      setProviderModels(res.models);
    } catch (e) {
      if (ai.id !== requestedProvider) return;
      setModelsError(translateError(e));
    } finally {
      setLoadingModels(false);
    }
  }

  // Local-provider URL changes invalidate the previously fetched
  // catalog — that list belongs to the old endpoint.
  useEffect(() => {
    setProviderModels([]);
    setModelsError(null);
  }, [ai.ollamaBaseUrl, ai.lmstudioBaseUrl]);

  // Auto-populate the catalog dropdown so users don't have to hit
  // "Fetch models" before they can pick one. Skip cloud providers when
  // no key is configured (the request would fail with a 401).
  useEffect(() => {
    if (loading) return;
    const info = providers.find((p) => p.id === ai.id);
    if (!info?.implemented) return;
    if (info.requiresKey && !info.hasKey) return;
    void fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.id, ai.ollamaBaseUrl, ai.lmstudioBaseUrl, loading, providers]);

  const current = providers.find((p) => p.id === ai.id);

  async function handleSelect(id: AgentProviderId): Promise<void> {
    setTestResult(null);
    // Use the backend's authoritative defaultModel so this stays in
    // sync with whatever the Rust trait says. Empty string means
    // "no static default" (LM Studio); user picks from the live list.
    let fallback = providers.find((p) => p.id === id)?.defaultModel ?? "";
    // For Ollama, the static default (`qwen3-coder`) is rarely what the
    // user actually has installed. Probe and pick the best installed
    // model upfront so test-connection works on first try.
    if (id === "ollama") {
      const probe = await probeOllama(ai.ollamaBaseUrl);
      if (probe.reachable && probe.models.length > 0) {
        fallback = pickBestModel(probe.models, fallback);
        setInstalledModels(probe.models);
      }
    }
    await setSetting("aiProvider", {
      id,
      mode: id === "ollama" || id === "lmstudio" ? "local" : "cloud",
      model: fallback,
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
      setKeyError(translateError(e));
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
      setKeyError(translateError(e));
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
        message: t("ai.modelReplied", { model: res.model, sample: res.sample.slice(0, 80) }),
        latencyMs: res.latencyMs,
      });
    } catch (e) {
      setTestResult({
        ok: false,
        message: translateError(e),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">
        <span className="daisu-glyph mr-2" aria-hidden="true">話</span>
        {t("ai.title")}
      </h2>
      <p className="daisu-settings-section-desc">{t("ai.intro")}</p>

      <h3 className="daisu-settings-section-title">{t("ai.providerHeading")}</h3>
      <div className="daisu-radio-list">
        {loading && (
          <p className="daisu-field-desc">{t("ai.loadingProviders")}</p>
        )}
        {!loading && loadError && (
          <div className="daisu-test-status is-fail" role="alert">
            <WarningCircle size={14} weight="fill" />
            {t("ai.loadError", { error: loadError })}
            <button
              type="button"
              className="daisu-btn ml-2"
              onClick={() => void refresh()}
            >
              <ArrowClockwise size={12} /> {t("ai.retry")}
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
                    <span className="daisu-pill-muted">{t("ai.comingSoon")}</span>
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
                        ? t("ai.keyConfigured")
                        : t("ai.keyRequired")
                      : t("ai.localNoKey")
                    : t("ai.implPhase")}
                  {p.implemented && p.supportsTools ? " · tools" : ""}
                </p>
              </div>
            </label>
          ))}
      </div>

      <h3 className="daisu-settings-section-title">{t("ai.modelHeading")}</h3>
      <div className="daisu-field">
        <div className="daisu-field-text">
          <label className="daisu-field-label" htmlFor="ai-model">
            {t("ai.modelLabel")}
          </label>
          <p className="daisu-field-desc">
            <Trans
              i18nKey="ai.modelHint"
              components={{ code: <code />, em: <em /> }}
            />
          </p>
        </div>
        <div className="flex flex-col gap-2 min-w-[260px] max-w-[360px] flex-1">
        {(() => {
          // Merge live catalog (cloud) and installed tags (Ollama) into a
          // single deduped option set. Native datalist filters by current
          // input value in WebView2, so we use a real Radix Select for a
          // guaranteed-clickable dropdown and keep the text input for
          // custom model ids.
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
          if (items.length === 0) return null;
          // Radix Select rejects empty-string values; omit `value` when
          // ai.model is blank so the trigger renders the placeholder.
          const selectProps =
            ai.model.length > 0 ? { value: ai.model } : {};
          return (
            <Select
              {...selectProps}
              onValueChange={(v) =>
                void setSetting("aiProvider", { model: v })
              }
            >
              <SelectTrigger aria-label={t("ai.selectModel")}>
                <SelectValue placeholder={t("ai.modelChoosePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {items.map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })()}
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
      </div>
      <div className="daisu-field-row">
        <button
          type="button"
          className="daisu-btn"
          disabled={
            loadingModels ||
            (current?.requiresKey === true && !current.hasKey)
          }
          onClick={() => void fetchModels()}
        >
          {loadingModels ? t("ai.loadingModels") : t("ai.fetchModels")}
        </button>
        {providerModels.length > 0 && (
          <span className="daisu-test-status is-ok" aria-live="polite">
            <CheckCircle size={12} weight="fill" />
            {t("ai.modelsFound", { count: providerModels.length })}
          </span>
        )}
        {modelsError && (
          <span className="daisu-test-status is-fail" role="alert">
            <WarningCircle size={12} weight="fill" />
            {modelsError}
          </span>
        )}
      </div>
      {ai.id === "ollama" && (
        <div className="daisu-field-row">
          <button
            type="button"
            className="daisu-btn"
            disabled={detecting}
            onClick={() => void handleDetect()}
          >
            {detecting ? t("ai.detecting") : t("ai.detect")}
          </button>
          {detectMsg && (
            <span className="daisu-test-status" aria-live="polite">
              {detectMsg}
            </span>
          )}
        </div>
      )}

      {(ai.id === "ollama" || ai.id === "lmstudio") && (
        <div className="daisu-field">
          <div className="daisu-field-text">
            <label className="daisu-field-label" htmlFor="ai-base-url">
              {t("ai.baseUrlLabel")}
            </label>
            <p className="daisu-field-desc">
              <Trans i18nKey="ai.baseUrlHint" components={{ code: <code /> }} />
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
          <h3 className="daisu-settings-section-title">{t("ai.apiKeyHeading")}</h3>
          <p className="daisu-field-desc" id="ai-key-desc">
            {t("ai.apiKeyDesc")}
          </p>
          <div className="daisu-field-row">
            <label htmlFor="ai-key-input" className="sr-only">
              {t("ai.apiKeyLabel", { provider: current.name })}
            </label>
            <input
              id="ai-key-input"
              type="password"
              className="daisu-input daisu-input-mono"
              placeholder={current.hasKey ? t("ai.apiKeyPlaceholderSet") : "sk-..."}
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
              {savingKey ? t("ai.savingButton") : t("ai.saveButton")}
            </button>
            {current.hasKey && (
              <button
                type="button"
                className="daisu-btn"
                onClick={() => void handleClearKey()}
              >
                {t("ai.deleteButton")}
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

      <h3 className="daisu-settings-section-title">{t("ai.symbolIndex")}</h3>
      <p className="daisu-settings-section-desc">{t("ai.indexFullHint")}</p>
      <div className="daisu-field-row">
        <button
          type="button"
          className="daisu-btn daisu-btn-primary"
          disabled={!rootPath || reindexing}
          onClick={() => void handleReindex()}
        >
          {reindexing ? t("ai.reindexing") : t("ai.reindex")}
        </button>
        <span className="daisu-test-status" aria-live="polite">
          {!rootPath && t("ai.openFolderToIndex")}
          {rootPath && idxStatus && (
            <>
              {t("ai.symbolsCount", { count: idxStatus.symbols })}
              {idxStatus.lastRebuild != null &&
                t("ai.lastIndex", {
                  when: new Date(idxStatus.lastRebuild * 1000).toLocaleTimeString(),
                })}
            </>
          )}
          {rootPath && !idxStatus && t("ai.noIndexYet")}
          {reindexMsg && ` · ${reindexMsg}`}
        </span>
      </div>

      <PermissionsSection />

      <h3 className="daisu-settings-section-title">{t("ai.connectionTest")}</h3>
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
          {testing ? t("ai.testing") : t("ai.testButton")}
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

function PermissionsSection(): JSX.Element {
  const { t } = useTranslation();
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
          {t("ai.permissionsHeading")}
        </button>
      </h3>
      {expanded && (
        <div className="daisu-field">
          <div className="daisu-field-text">
            <p className="daisu-field-desc">{t("ai.permissionsDesc")}</p>
          </div>
          {!workspacePath && (
            <p className="daisu-field-desc">{t("ai.openWorkspaceForPerms")}</p>
          )}
          {workspacePath && (
            <>
              {loading && <p className="daisu-field-desc">{t("common.loading")}</p>}
              {error && (
                <p className="daisu-test-status is-fail" role="alert">
                  <WarningCircle size={12} weight="fill" />
                  {error}
                </p>
              )}
              {!loading && entries.length === 0 && (
                <p className="daisu-field-desc">{t("ai.noEntries")}</p>
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
                  {t("ai.refresh")}
                </button>
                <button
                  type="button"
                  className="daisu-btn"
                  disabled={entries.length === 0}
                  onClick={() => void handleClearAll()}
                >
                  {t("ai.deleteAll")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
