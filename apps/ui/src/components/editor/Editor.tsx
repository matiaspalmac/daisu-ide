import { useEffect, useRef, type JSX } from "react";
import { Editor as MonacoEditor, type Monaco, type OnMount } from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import { useTabs } from "../../stores/tabsStore";
import { getOrCreateModel } from "../../lib/monaco-models";
import {
  setActiveEditor,
  setMonacoNamespace,
} from "../../lib/monaco-editor-ref";

type IStandaloneCodeEditor = monacoNs.editor.IStandaloneCodeEditor;

export function Editor(): JSX.Element {
  const editorRef = useRef<IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const prevActiveRef = useRef<string | null>(null);
  const activeTabId = useTabs((s) => s.activeTabId);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setActiveEditor(editor);
    setMonacoNamespace(monaco);
    syncActiveTab();
  };

  useEffect(() => {
    return () => {
      setActiveEditor(null);
      setMonacoNamespace(null);
    };
  }, []);

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
    editor.focus();
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
