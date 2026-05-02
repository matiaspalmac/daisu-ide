import type { JSX } from "react";
import { useState } from "react";
import { Editor } from "./components/Editor";

export function App(): JSX.Element {
  const [content, setContent] = useState<string>("// Daisu IDE — Monaco hello world\n// Open / save in Tasks 6 and 7\n");

  return (
    <main className="daisu-shell">
      <header className="daisu-toolbar">
        <h1>Daisu IDE</h1>
      </header>
      <section className="daisu-editor-host">
        <Editor value={content} language="typescript" onChange={setContent} />
      </section>
    </main>
  );
}
