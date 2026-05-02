import type { JSX } from "react";
import { useState } from "react";
import { Editor } from "./components/Editor";
import { openFileViaDialog } from "./api/tauri";

const INITIAL_CONTENT = "// Welcome to Daisu IDE\n// Click Open to load a file.\n";

export function App(): JSX.Element {
  const [path, setPath] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>("plaintext");
  const [content, setContent] = useState<string>(INITIAL_CONTENT);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen(): Promise<void> {
    setError(null);
    try {
      const opened = await openFileViaDialog();
      if (opened === null) {
        return;
      }
      setPath(opened.path);
      setLanguage(opened.language);
      setContent(opened.contents);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="daisu-shell">
      <header className="daisu-toolbar">
        <h1>Daisu IDE</h1>
        <button type="button" onClick={handleOpen} className="daisu-btn">
          Open…
        </button>
        <span className="daisu-path">{path ?? "(no file)"}</span>
        {error !== null ? <span className="daisu-err">{error}</span> : null}
      </header>
      <section className="daisu-editor-host">
        <Editor value={content} language={language} onChange={setContent} />
      </section>
    </main>
  );
}
