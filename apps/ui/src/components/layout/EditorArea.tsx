import type { JSX } from "react";
import { Editor } from "../editor/Editor";
import { TabBar } from "../tabs/TabBar";
import { WelcomeScreen } from "./WelcomeScreen";
import { useTabs } from "../../stores/tabsStore";

export function EditorArea(): JSX.Element {
  const tabs = useTabs((s) => s.tabs);
  const activeTabId = useTabs((s) => s.activeTabId);
  const hasActiveFile = tabs.length > 0 && activeTabId !== null;

  return (
    <section className="daisu-editor-region h-full flex flex-col min-h-0" aria-label="Editor area">
      <TabBar />
      <div className="flex-1 min-h-0 relative">
        {hasActiveFile ? (
          <div className="daisu-editor-host h-full w-full">
            <Editor />
          </div>
        ) : (
          <WelcomeScreen />
        )}
      </div>
    </section>
  );
}
