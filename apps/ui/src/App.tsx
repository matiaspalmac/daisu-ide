import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { Editor } from "./components/editor/Editor";
import {
  detectWebView2,
  openFileViaDialog,
  saveFile,
  saveFileAsViaDialog,
} from "./api/tauri";

const INITIAL_CONTENT = "// Welcome to Daisu IDE\n// Open or create a file. Ctrl+S to save.\n";

export function App(): JSX.Element {
  const [path, setPath] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>("plaintext");
  const [content, setContent] = useState<string>(INITIAL_CONTENT);
  const [dirty, setDirty] = useState<boolean>(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webview2Missing, setWebview2Missing] = useState<boolean>(false);

  useEffect(() => {
    detectWebView2()
      .then((status) => setWebview2Missing(!status.installed))
      .catch(() => setWebview2Missing(false));
  }, []);

  const handleOpen = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const opened = await openFileViaDialog();
      if (opened === null) {
        return;
      }
      setPath(opened.path);
      setLanguage(opened.language);
      setContent(opened.contents);
      setDirty(false);
      setStatus(`Opened ${opened.path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleSave = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      if (path === null) {
        const saved = await saveFileAsViaDialog(content);
        if (saved === null) {
          return;
        }
        setPath(saved);
        setStatus(`Saved as ${saved}`);
      } else {
        await saveFile(path, content);
        setStatus(`Saved ${path}`);
      }
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [path, content]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

  function handleChange(next: string): void {
    setContent(next);
    setDirty(true);
  }

  return (
    <main className="daisu-shell">
      {webview2Missing ? (
        <div className="daisu-banner">
          WebView2 Runtime not detected. Download:{" "}
          <a
            href="https://developer.microsoft.com/en-us/microsoft-edge/webview2/"
            target="_blank"
            rel="noreferrer"
          >
            Microsoft Evergreen Bootstrapper
          </a>
        </div>
      ) : null}
      <header className="daisu-toolbar">
        <h1>Daisu IDE</h1>
        <button type="button" onClick={handleOpen} className="daisu-btn">
          Open…
        </button>
        <button type="button" onClick={handleSave} className="daisu-btn">
          Save
        </button>
        <span className="daisu-path">
          {path ?? "(unsaved)"}
          {dirty ? " ●" : ""}
        </span>
        {status !== null && error === null ? (
          <span className="daisu-status">{status}</span>
        ) : null}
        {error !== null ? <span className="daisu-err">{error}</span> : null}
      </header>
      <section className="daisu-editor-host">
        <Editor value={content} language={language} onChange={handleChange} />
      </section>
    </main>
  );
}
