import { useEffect, useRef, type JSX } from "react";
import {
  Editor as MonacoEditor,
  loader,
  type BeforeMount,
  type Monaco,
  type OnMount,
} from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import * as monacoLocal from "monaco-editor";
import { attach as attachLsp, trackModelOpen as trackLspModel } from "../../lsp/monacoBridge";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// Tauri webview blocks CDN loading; route Monaco to the locally-bundled
// package and supply Vite-bundled web workers so language services work.
// Wrapped in a guard so test/SSR environments without `window` skip setup
// (per Monaco bundle gotcha — keep type-only imports for non-editor code).
let monacoLoaderConfigured = false;
function setupMonacoEnvironment(): void {
  if (typeof window === "undefined" || monacoLoaderConfigured) return;
  monacoLoaderConfigured = true;
  // Register the Tron/Daisu theme on the bundled Monaco namespace BEFORE any
  // editor is created, so the very first <MonacoEditor theme=...> resolves
  // to a defined theme. Without this, fast reopens land on vs-dark because
  // the bundled namespace had no themes registered yet. Guarded for tests
  // that mock monaco-editor without a full editor namespace.
  try {
    if (typeof monacoLocal.editor?.defineTheme === "function") {
      monacoLocal.editor.defineTheme(
        TRON_DARK_NAME,
        TRON_DARK as monacoNs.editor.IStandaloneThemeData,
      );
      monacoLocal.editor.setTheme(TRON_DARK_NAME);
    }
  } catch {
    /* test/SSR environments without a real Monaco namespace — best effort */
  }
  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
      switch (label) {
        case "json":
          return new jsonWorker();
        case "css":
        case "scss":
        case "less":
          return new cssWorker();
        case "html":
        case "handlebars":
        case "razor":
          return new htmlWorker();
        case "typescript":
        case "javascript":
          return new tsWorker();
        default:
          return new editorWorker();
      }
    },
  };
  loader.config({ monaco: monacoLocal });
}
import { useTabs } from "../../stores/tabsStore";
import { getOrCreateModel } from "../../lib/monaco-models";
import {
  setActiveEditor,
  setMonacoNamespace,
} from "../../lib/monaco-editor-ref";
import { applyTheme, flushPendingTheme } from "../../hooks/useTheme";
import { useSettings } from "../../stores/settingsStore";
import { keySoundEngine, keyKindFromCode } from "../../lib/key-sound";
import { TRON_DARK, TRON_DARK_NAME } from "../../lib/monaco-tron-theme";

type IStandaloneCodeEditor = monacoNs.editor.IStandaloneCodeEditor;

setupMonacoEnvironment();

export function Editor(): JSX.Element {
  const editorRef = useRef<IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const prevActiveRef = useRef<string | null>(null);
  const activeTabId = useTabs((s) => s.activeTabId);
  const keySoundEnabled = useSettings((s) => s.settings.editor.keySoundEnabled);
  const keySoundVolume = useSettings((s) => s.settings.editor.keySoundVolume);
  const keySoundPack = useSettings((s) => s.settings.editor.keySoundPack);

  useEffect(() => {
    keySoundEngine.setEnabled(keySoundEnabled);
  }, [keySoundEnabled]);
  useEffect(() => {
    keySoundEngine.setVolume(keySoundVolume);
  }, [keySoundVolume]);
  useEffect(() => {
    keySoundEngine.setPack(keySoundPack);
  }, [keySoundPack]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    // Register Tron BEFORE editor creation so the `theme` prop resolves to a
    // defined theme. Otherwise @monaco-editor/react falls back to vs-dark.
    monaco.editor.defineTheme(TRON_DARK_NAME, TRON_DARK);
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.setTheme(TRON_DARK_NAME);
    // Re-apply the active theme imperatively in case the user switched
    // workspaces and the Editor remounted — useTheme effect won't re-fire
    // since activeThemeId hasn't changed.
    void applyTheme(useSettings.getState().settings.themes.activeThemeId);
    // Phase 5: cursor + selection listeners attach via useEditorCursorWiring()
    // mounted in App.tsx; that hook polls getActiveEditor() until non-null.
    setActiveEditor(editor);
    setMonacoNamespace(monaco);
    flushPendingTheme();
    syncActiveTab();
    editor.onKeyDown((e) => {
      const kind = keyKindFromCode(e.code);
      if (kind) keySoundEngine.play(kind, false);
    });
    editor.onKeyUp((e) => {
      const kind = keyKindFromCode(e.code);
      if (kind) keySoundEngine.play(kind, true);
    });
    // M4.1: wire LSP bridge + per-model didOpen/didChange/didClose.
    void attachLsp(monaco);
    const initialModel = editor.getModel();
    if (initialModel) void trackLspModel(initialModel);
    editor.onDidChangeModel(() => {
      const newModel = editor.getModel();
      if (newModel) void trackLspModel(newModel);
    });
  };

  useEffect(() => {
    return () => {
      setActiveEditor(null);
      setMonacoNamespace(null);
    };
  }, []);

  // NOTE: a previous version installed a global capture-phase mousedown blur
  // + focusin guard here. Per the bugs-frontend audit the listener was masking
  // the underlying issue (auto-focus on every tab switch) and itself created a
  // re-focus loop. With `editor.focus()` removed from syncActiveTab the blur
  // hack is no longer needed. Trixty IDE (same Tauri+Monaco+React stack)
  // relies purely on plain onClick handlers without any blur trickery.

  function syncActiveTab(): void {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const state = useTabs.getState();
    const newId = state.activeTabId;
    const prev = prevActiveRef.current;
    if (prev && prev !== newId) {
      const view = editor.saveViewState();
      state._setCursorState(prev, view);
    }
    if (!newId) {
      editor.setModel(null);
      prevActiveRef.current = null;
      return;
    }
    const tab = state.tabs.find((t) => t.id === newId);
    if (!tab) return;
    const model = getOrCreateModel(monaco, tab) as monacoNs.editor.ITextModel;
    editor.setModel(model);
    // Defensive: ensure the active theme is applied each time we swap models.
    // Some workspace re-open paths leave Monaco on its vs-dark default until a
    // setTheme call is made post-create, so we re-assert here.
    monaco.editor.setTheme(TRON_DARK_NAME);
    void applyTheme(useSettings.getState().settings.themes.activeThemeId);
    if (tab.cursorState) {
      editor.restoreViewState(tab.cursorState);
    }
    // NOTE: do NOT call editor.focus() here. Auto-stealing focus on every tab
    // switch causes the "needs-double-click" symptom — Monaco re-captures
    // focus immediately after our global mousedown blur fix releases it. The
    // user can click into the editor to start typing.
    prevActiveRef.current = newId;
  }

  useEffect(() => {
    syncActiveTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  return (
    <div className="h-full w-full">
    <MonacoEditor
      height="100%"
      width="100%"
      theme={TRON_DARK_NAME}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        lineNumbers: "on",
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
        fontLigatures: true,
        lineHeight: 1.55,
        letterSpacing: 0.2,
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        cursorBlinking: "smooth",
        cursorWidth: 2,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        wordWrap: "off",
        renderLineHighlight: "all",
        bracketPairColorization: { enabled: true },
        guides: {
          indentation: true,
          highlightActiveIndentation: true,
          bracketPairs: "active",
        },
        padding: { top: 10, bottom: 10 },
        roundedSelection: false,
        renderWhitespace: "selection",
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
          useShadows: false,
        },
        overviewRulerBorder: false,
        stickyScroll: { enabled: true },
      }}
    />
    </div>
  );
}
