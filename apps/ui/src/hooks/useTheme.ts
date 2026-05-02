import { useEffect } from "react";
import type * as monacoNs from "monaco-editor";
import { listen } from "@tauri-apps/api/event";
import { readThemeJsonCmd } from "../api/tauri";
import { ThemeSchema } from "../lib/theme-schema";
import { toCssVars, toMonacoTheme } from "../lib/theme-loader";
import { getMonacoNamespace } from "../lib/monaco-editor-ref";
import { useSettings } from "../stores/settingsStore";

export async function applyTheme(id: string): Promise<void> {
  const json = await readThemeJsonCmd(id);
  const parsed = ThemeSchema.parse(json);
  const cssVars = toCssVars(parsed.colors ?? {});
  for (const [varName, value] of Object.entries(cssVars)) {
    document.documentElement.style.setProperty(varName, value);
  }
  const monaco = getMonacoNamespace();
  if (!monaco) return;
  const monacoData = toMonacoTheme(parsed) as monacoNs.editor.IStandaloneThemeData;
  monaco.editor.defineTheme(id, monacoData);
  monaco.editor.setTheme(id);
}

export function useTheme(): void {
  const activeThemeId = useSettings((s) => s.settings.themes.activeThemeId);
  const autoSwitchOnSystem = useSettings((s) => s.settings.themes.autoSwitchOnSystem);
  const systemDarkTheme = useSettings((s) => s.settings.themes.systemDarkTheme);
  const systemLightTheme = useSettings((s) => s.settings.themes.systemLightTheme);

  useEffect(() => {
    if (autoSwitchOnSystem) return;
    void applyTheme(activeThemeId);
  }, [autoSwitchOnSystem, activeThemeId]);

  useEffect(() => {
    if (!autoSwitchOnSystem) return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void => {
      const id = mql.matches ? systemDarkTheme : systemLightTheme;
      void applyTheme(id);
    };
    apply();
    mql.addEventListener("change", apply);

    let unlistenTauri: (() => void) | null = null;
    void listen<"light" | "dark">("tauri://theme-changed", apply).then((fn) => {
      unlistenTauri = fn;
    });

    return () => {
      mql.removeEventListener("change", apply);
      if (unlistenTauri) unlistenTauri();
    };
  }, [autoSwitchOnSystem, systemDarkTheme, systemLightTheme]);
}
