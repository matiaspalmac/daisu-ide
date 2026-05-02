import type { JSX } from "react";
import MonacoEditor from "@monaco-editor/react";

export interface EditorProps {
  value: string;
  language: string;
  onChange: (value: string) => void;
}

export function Editor({ value, language, onChange }: EditorProps): JSX.Element {
  return (
    <MonacoEditor
      height="100%"
      width="100%"
      theme="vs-dark"
      language={language}
      value={value}
      onChange={(next) => onChange(next ?? "")}
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
