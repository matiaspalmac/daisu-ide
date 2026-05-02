import type { JSX } from "react";
import { Editor } from "../editor/Editor";
import { TabBar } from "../tabs/TabBar";
import { useTabs } from "../../stores/tabsStore";

export function EditorArea(): JSX.Element {
  const tabs = useTabs((s) => s.tabs);

  return (
    <section className="daisu-editor-region" aria-label="Editor area">
      <TabBar />
      {tabs.length === 0 ? (
        <div className="daisu-empty-state">
          <h3>No file open</h3>
          <p>Open a file from the sidebar or Ctrl+N for an untitled tab.</p>
        </div>
      ) : (
        <div className="daisu-editor-host">
          <Editor />
        </div>
      )}
    </section>
  );
}
