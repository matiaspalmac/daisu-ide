import { describe, expect, it } from "vitest";
import {
  pickMonacoColors,
  toCssVars,
  toMonacoTheme,
  convertTokenColors,
} from "../../src/lib/theme-loader";

const sampleTheme = {
  name: "Sample Dark",
  type: "dark" as const,
  colors: {
    "editor.background": "#1f1f1f",
    "editor.foreground": "#cccccc",
    "sideBar.background": "#181818",
    "tab.activeBackground": "#1f1f1f",
    "statusBar.background": "#181818",
    "panel.border": "#2b2b2b",
  },
  tokenColors: [
    { scope: "comment", settings: { foreground: "#6a9955", fontStyle: "italic" } },
    { scope: "string", settings: { foreground: "#ce9178" } },
    { scope: ["keyword", "storage.type"], settings: { foreground: "#569cd6" } },
  ],
};

describe("toMonacoTheme", () => {
  it("resolves base from type=dark", () => {
    const data = toMonacoTheme(sampleTheme);
    expect(data.base).toBe("vs-dark");
    expect(data.inherit).toBe(true);
  });

  it("resolves base from type=light", () => {
    const data = toMonacoTheme({ ...sampleTheme, type: "light" });
    expect(data.base).toBe("vs");
  });

  it("emits a rule per scope (multi-scope arrays flattened)", () => {
    const data = toMonacoTheme(sampleTheme);
    const tokens = data.rules.map((r) => r.token);
    expect(tokens).toContain("comment");
    expect(tokens).toContain("string");
    expect(tokens).toContain("keyword");
    expect(tokens).toContain("type.keyword");
  });

  it("preserves italic fontStyle on comments", () => {
    const data = toMonacoTheme(sampleTheme);
    const c = data.rules.find((r) => r.token === "comment");
    expect(c?.fontStyle).toBe("italic");
  });

  it("strips alpha from 8-digit hex foreground", () => {
    const data = toMonacoTheme({
      ...sampleTheme,
      tokenColors: [{ scope: "comment", settings: { foreground: "#11223344" } }],
    });
    const c = data.rules.find((r) => r.token === "comment");
    expect(c?.foreground).toBe("#112233");
  });

  it("skips token colors whose scope does not map", () => {
    const data = toMonacoTheme({
      ...sampleTheme,
      tokenColors: [
        { scope: "comment", settings: { foreground: "#aaa" } },
        { scope: "totally.unknown", settings: { foreground: "#bbb" } },
      ],
    });
    expect(data.rules.find((r) => r.token === "comment")).toBeDefined();
    expect(data.rules.length).toBe(1);
  });
});

describe("pickMonacoColors", () => {
  it("keeps editor.* and editorLineNumber.* keys", () => {
    const out = pickMonacoColors({
      "editor.background": "#1f1f1f",
      "editorLineNumber.foreground": "#aaa",
      "sideBar.background": "#181818",
    });
    expect(out["editor.background"]).toBe("#1f1f1f");
    expect(out["editorLineNumber.foreground"]).toBe("#aaa");
    expect(out["sideBar.background"]).toBeUndefined();
  });
});

describe("toCssVars", () => {
  it("emits sidebar, tab, statusbar, border CSS vars", () => {
    const vars = toCssVars(sampleTheme.colors);
    expect(vars["--daisu-bg"]).toBe("#1f1f1f");
    expect(vars["--daisu-fg"]).toBe("#cccccc");
    expect(vars["--daisu-sidebar-bg"]).toBe("#181818");
    expect(vars["--daisu-tab-active-bg"]).toBe("#1f1f1f");
    expect(vars["--daisu-statusbar-bg"]).toBe("#181818");
    expect(vars["--daisu-border"]).toBe("#2b2b2b");
  });

  it("returns empty record for empty input", () => {
    expect(Object.keys(toCssVars({}))).toHaveLength(0);
  });
});

describe("convertTokenColors", () => {
  it("returns empty array for undefined input", () => {
    expect(convertTokenColors(undefined)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(convertTokenColors([])).toEqual([]);
  });
});
