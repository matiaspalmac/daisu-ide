// Probes a local Ollama server and ranks installed models so Daisu can pick a
// sensible default. Read-only HTTP — no Tauri command needed.

interface OllamaTag {
  name: string;
  size?: number;
  modified_at?: string;
}

export interface OllamaProbe {
  reachable: boolean;
  models: string[];
}

const PREFERENCE_PATTERNS: RegExp[] = [
  /qwen.*coder/i,
  /deepseek.*coder/i,
  /codellama/i,
  /starcoder/i,
  /codestral/i,
  /coder/i,
  /code/i,
  /qwen/i,
  /llama3\.?2/i,
  /llama3/i,
  /mistral/i,
  /phi/i,
];

function rankModel(name: string): number {
  for (let i = 0; i < PREFERENCE_PATTERNS.length; i++) {
    if (PREFERENCE_PATTERNS[i]!.test(name)) return i;
  }
  return PREFERENCE_PATTERNS.length;
}

const CACHE_KEY = "daisu:ollama-probe";
const CACHE_TTL_MS = 60_000;

interface CachedProbe extends OllamaProbe {
  baseUrl: string;
  ts: number;
}

function readCache(baseUrl: string): OllamaProbe | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedProbe;
    if (parsed.baseUrl !== baseUrl) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return { reachable: parsed.reachable, models: parsed.models };
  } catch {
    return null;
  }
}

function writeCache(baseUrl: string, probe: OllamaProbe): void {
  try {
    const payload: CachedProbe = { ...probe, baseUrl, ts: Date.now() };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* sessionStorage may be disabled */
  }
}

export function clearOllamaCache(): void {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* noop */
  }
}

export async function probeOllama(
  baseUrl: string,
  opts: { force?: boolean } = {},
): Promise<OllamaProbe> {
  if (!opts.force) {
    const cached = readCache(baseUrl);
    if (cached) return cached;
  }
  try {
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: ctrl.signal,
    });
    window.clearTimeout(timeout);
    if (!res.ok) {
      const probe: OllamaProbe = { reachable: false, models: [] };
      writeCache(baseUrl, probe);
      return probe;
    }
    const data = (await res.json()) as { models?: OllamaTag[] };
    const names = (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    names.sort((a, b) => rankModel(a) - rankModel(b));
    const probe: OllamaProbe = { reachable: true, models: names };
    writeCache(baseUrl, probe);
    return probe;
  } catch {
    return { reachable: false, models: [] };
  }
}

export function pickBestModel(installed: string[], current: string): string {
  if (installed.length === 0) return current;
  if (installed.includes(current)) return current;
  return installed[0]!;
}
