import type { JSX } from "react";
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

  // Monaco stays mounted across Home/file tab switches. Conditionally
  // unmounting it (the previous behaviour) caused a black canvas after
  // bouncing through the Home tab — Monaco's internal layout/theme
  // pipeline doesn't recover from a 0×0 → fullsize remount cleanly. The
  // WelcomeScreen now overlays on top when no file is active, and Editor
  // observes its tabs store and clears the model when activeTabId is null.
  return (
    <section className="daisu-editor-region h-full flex flex-col min-h-0" aria-label={t("editor.areaAria")}>
      <TabBar />
      {hasActiveFile && <Breadcrumb />}
      <div className="flex-1 min-h-0 relative">
        <div
          className="daisu-editor-host absolute inset-0"
          aria-hidden={!hasActiveFile}
          style={hasActiveFile ? undefined : { visibility: "hidden" }}
        >
          <Editor />
        </div>
        {!hasActiveFile && (
          <div className="absolute inset-0 bg-[var(--bg-primary)]">
            <WelcomeScreen />
          </div>
        )}
      </div>
    </section>
  );
}
