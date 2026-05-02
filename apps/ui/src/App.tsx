import type { JSX } from "react";

export function App(): JSX.Element {
  return (
    <main className="daisu-shell">
      <header className="daisu-toolbar">
        <h1>Daisu IDE</h1>
      </header>
      <section className="daisu-editor-host">
        <p>Editor will mount here in Task 5.</p>
      </section>
    </main>
  );
}
