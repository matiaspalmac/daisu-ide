import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { Editor } from "../editor/Editor";
import { TabBar } from "../tabs/TabBar";
import { WelcomeScreen } from "./WelcomeScreen";
import { Breadcrumb } from "./Breadcrumb";
import { useTabs } from "../../stores/tabsStore";

export function EditorArea(): JSX.Element {
  const { t } = useTranslation();
  const tabs = useTabs((s) => s.tabs);
  const activeTabId = useTabs((s) => s.activeTabId);
  const hasActiveFile = tabs.length > 0 && activeTabId !== null;

  // Once the user opens a real file we keep the Editor mounted forever,
  // even when they bounce to the Home tab. Disposing Monaco on every
  // round-trip caused the black-canvas bug — re-mount races through
  // theme / layout / model swap and frequently lands on a 0×0 viewport.
  // Before the first real file we don't mount Editor at all so the
  // initial paint isn't blocked on Monaco workers booting.
  const [editorEverMounted, setEditorEverMounted] = useState(false);
  useEffect(() => {
    if (hasActiveFile) setEditorEverMounted(true);
  }, [hasActiveFile]);

  return (
    <section className="daisu-editor-region h-full flex flex-col min-h-0" aria-label={t("editor.areaAria")}>
      <TabBar />
      {hasActiveFile && <Breadcrumb />}
      <div className="flex-1 min-h-0 relative">
        {editorEverMounted && (
          <div
            className="daisu-editor-host h-full w-full"
            style={hasActiveFile ? undefined : { display: "none" }}
            aria-hidden={!hasActiveFile}
          >
            <Editor />
          </div>
        )}
        {!hasActiveFile && <WelcomeScreen />}
      </div>
    </section>
  );
}
