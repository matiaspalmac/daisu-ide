import { useEffect, useRef, type JSX } from "react";
import { Editor as MonacoEditor, loader, type Monaco, type OnMount } from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import * as monacoLocal from "monaco-editor";
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
import { flushPendingTheme } from "../../hooks/useTheme";

type IStandaloneCodeEditor = monacoNs.editor.IStandaloneCodeEditor;

setupMonacoEnvironment();

export function Editor(): JSX.Element {
  const editorRef = useRef<IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const prevActiveRef = useRef<string | null>(null);
  const activeTabId = useTabs((s) => s.activeTabId);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Phase 5: cursor + selection listeners attach via useEditorCursorWiring()
    // mounted in App.tsx; that hook polls getActiveEditor() until non-null.
    setActiveEditor(editor);
    setMonacoNamespace(monaco);
    flushPendingTheme();
    syncActiveTab();
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
    <MonacoEditor
      height="100%"
      width="100%"
      theme="vs-dark"
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "Cascadia Code, Consolas, monospace",
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        automaticLayout: true,
        scrollBeyondLastLine: false,
        wordWrap: "off",
        renderLineHighlight: "all",
        bracketPairColorization: { enabled: true },
      }}
    />
  );
}
