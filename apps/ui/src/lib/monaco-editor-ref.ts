import type * as monacoNs from "monaco-editor";
import type { Monaco } from "@monaco-editor/react";

let activeEditor: monacoNs.editor.IStandaloneCodeEditor | null = null;
let monacoNamespace: Monaco | null = null;

export function setActiveEditor(
  editor: monacoNs.editor.IStandaloneCodeEditor | null,
): void {
  activeEditor = editor;
}

export function getActiveEditor(): monacoNs.editor.IStandaloneCodeEditor | null {
  return activeEditor;
}

export function setMonacoNamespace(monaco: Monaco | null): void {
  monacoNamespace = monaco;
}

export function getMonacoNamespace(): Monaco | null {
  return monacoNamespace;
}
