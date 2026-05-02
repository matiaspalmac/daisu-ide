import type { ParsedTheme } from "./theme-schema";
import { longestPrefixMatch } from "./scope-token-map";

/**
 * A subset of Monaco's `IStandaloneThemeData` shape. Mirrored locally
 * so we don't pull a runtime dep on `monaco-editor` from this module.
 */
export interface MonacoTokenRule {
  token: string;
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

export interface MonacoThemeData {
  base: "vs" | "vs-dark" | "hc-black" | "hc-light";
  inherit: boolean;
  rules: MonacoTokenRule[];
  colors: Record<string, string>;
}

const MONACO_COLOR_PREFIXES = [
  "editor.",
  "editorCursor.",
  "editorLineNumber.",
  "editorIndentGuide.",
  "editorWhitespace.",
  "editorBracketHighlight.",
  "editorGutter.",
  "editorOverviewRuler.",
  "editorWidget.",
  "editorSuggestWidget.",
  "editorHoverWidget.",
];

export function pickMonacoColors(
  colors: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    if (MONACO_COLOR_PREFIXES.some((p) => key.startsWith(p))) {
      out[key] = value;
    }
  }
  return out;
}

function strip6Hash(c: string): string {
  if (c.length === 9 && c.startsWith("#")) return c.slice(0, 7);
  return c;
}

export function convertTokenColors(
  tokenColors: ParsedTheme["tokenColors"],
): MonacoTokenRule[] {
  if (!tokenColors) return [];
  const rules: MonacoTokenRule[] = [];
  for (const tc of tokenColors) {
    if (!tc.scope) continue;
    const scopes = Array.isArray(tc.scope) ? tc.scope : [tc.scope];
    for (const scope of scopes) {
      const monacoToken = longestPrefixMatch(scope);
      if (!monacoToken) continue;
      const rule: MonacoTokenRule = { token: monacoToken };
      if (tc.settings.foreground) rule.foreground = strip6Hash(tc.settings.foreground);
      if (tc.settings.background) rule.background = strip6Hash(tc.settings.background);
      if (tc.settings.fontStyle) rule.fontStyle = tc.settings.fontStyle;
      rules.push(rule);
    }
  }
  return rules;
}

export function toMonacoTheme(parsed: ParsedTheme): MonacoThemeData {
  const base: MonacoThemeData["base"] =
    parsed.type === "light"
      ? "vs"
      : parsed.type === "hc-light"
        ? "hc-light"
        : parsed.type === "hc-dark"
          ? "hc-black"
          : "vs-dark";
  return {
    base,
    inherit: true,
    rules: convertTokenColors(parsed.tokenColors),
    colors: pickMonacoColors(parsed.colors ?? {}),
  };
}

export function toCssVars(colors: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  if (colors["editor.background"]) map["--daisu-bg"] = colors["editor.background"];
  if (colors["editor.foreground"]) map["--daisu-fg"] = colors["editor.foreground"];
  if (colors["sideBar.background"])
    map["--daisu-sidebar-bg"] = colors["sideBar.background"];
  if (colors["sideBar.foreground"])
    map["--daisu-sidebar-fg"] = colors["sideBar.foreground"];
  if (colors["tab.activeBackground"])
    map["--daisu-tab-active-bg"] = colors["tab.activeBackground"];
  if (colors["tab.inactiveBackground"])
    map["--daisu-tab-inactive-bg"] = colors["tab.inactiveBackground"];
  if (colors["tab.activeForeground"])
    map["--daisu-tab-active-fg"] = colors["tab.activeForeground"];
  if (colors["tab.inactiveForeground"])
    map["--daisu-tab-inactive-fg"] = colors["tab.inactiveForeground"];
  if (colors["statusBar.background"])
    map["--daisu-statusbar-bg"] = colors["statusBar.background"];
  if (colors["statusBar.foreground"])
    map["--daisu-statusbar-fg"] = colors["statusBar.foreground"];
  if (colors["titleBar.activeBackground"])
    map["--daisu-titlebar-bg"] = colors["titleBar.activeBackground"];
  if (colors["panel.border"]) map["--daisu-border"] = colors["panel.border"];
  return map;
}
