import type { JSX } from "react";
import { useTabs } from "../../stores/tabsStore";
import { Editor } from "../editor/Editor";

export function EditorArea(): JSX.Element {
  const activeTabId = useTabs((s) => s.activeTabId);
  const tab = useTabs((s) => s.tabs.find((t) => t.id === activeTabId) ?? null);
  const updateContent = useTabs((s) => s.updateContent);

  if (!tab) {
    return (
      <section className="daisu-editor-area daisu-editor-area-empty" aria-label="Editor area">
        <div className="daisu-welcome">
          <h2>Daisu IDE</h2>
          <p>Open a file or folder to begin.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="daisu-editor-area" aria-label="Editor area">
      <Editor
        value={tab.content}
        language={tab.language}
        onChange={(next) => updateContent(tab.id, next)}
      />
    </section>
  );
}
