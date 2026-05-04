import type { JSX } from "react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { FilePlus, FileText, FolderOpen, ArrowCounterClockwise } from "@phosphor-icons/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTabs, getScratchUntitled } from "../../stores/tabsStore";
import { useUI } from "../../stores/uiStore";
import { useWorkspace } from "../../stores/workspaceStore";
import { translateError } from "../../lib/error-translate";

interface ActionSpec {
  kbd: string;
  Icon: typeof FilePlus;
  label: string;
  onClick: () => void | Promise<void>;
}

// Curated classic haiku. One per day (deterministic). JP original always
// shown; the gloss text comes from the active i18n locale (welcome.haiku.N).
const HAIKU_JP: string[] = [
  "古池や蛙飛びこむ水の音",
  "閑さや岩にしみ入る蝉の声",
  "雀の子そこのけそこのけお馬が通る",
  "やせ蛙負けるな一茶これにあり",
  "朝顔につるべ取られてもらひ水",
  "菜の花や月は東に日は西に",
  "目には青葉山ほととぎす初鰹",
  "夏草や兵どもが夢の跡",
  "雪とけて村いっぱいの子どもかな",
  "我と来て遊べや親のない雀",
  "柿くへば鐘が鳴るなり法隆寺",
  "この道や行く人なしに秋の暮",
];
const HAIKU_AUTHORS: string[] = [
  "Bashō", "Bashō", "Issa", "Issa", "Chiyo-ni", "Buson",
  "Sodō", "Bashō", "Issa", "Issa", "Shiki", "Bashō",
];

function haikuTranslation(t: TFunction, idx: number): string {
  // Static literal switch — template literal keys fail the typed-key check.
  switch (idx) {
    case 0: return t("welcome.haiku.0");
    case 1: return t("welcome.haiku.1");
    case 2: return t("welcome.haiku.2");
    case 3: return t("welcome.haiku.3");
    case 4: return t("welcome.haiku.4");
    case 5: return t("welcome.haiku.5");
    case 6: return t("welcome.haiku.6");
    case 7: return t("welcome.haiku.7");
    case 8: return t("welcome.haiku.8");
    case 9: return t("welcome.haiku.9");
    case 10: return t("welcome.haiku.10");
    default: return t("welcome.haiku.11");
  }
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

function greetingKey(): string {
  const h = new Date().getHours();
  if (h < 6) return "night";
  if (h < 12) return "morning";
  if (h < 19) return "afternoon";
  return "evening";
}

export function WelcomeScreen(): JSX.Element {
  const { t } = useTranslation();
  const newTab = useTabs((s) => s.newTab);
  const openTab = useTabs((s) => s.openTab);
  const recoverScratch = useTabs((s) => s.recoverScratchUntitled);
  const openWorkspace = useWorkspace((s) => s.openWorkspace);
  const recents = useWorkspace((s) => s.recents);
  const pushToast = useUI((s) => s.pushToast);
  const haikuIdx = useMemo(() => dayOfYear(new Date()) % HAIKU_JP.length, []);
  const [scratchCount, setScratchCount] = useState(() => getScratchUntitled().length);

  const handleOpenFile = useCallback(async (): Promise<void> => {
    try {
      const selected = await openDialog({ multiple: false, directory: false });
      if (typeof selected === "string") await openTab(selected);
    } catch (e) {
      pushToast({ message: translateError(e), level: "error" });
    }
  }, [openTab, pushToast]);

  const handleOpenFolder = useCallback(async (): Promise<void> => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string") await openWorkspace(selected);
    } catch (e) {
      pushToast({ message: translateError(e), level: "error" });
    }
  }, [openWorkspace, pushToast]);

  const actions: ActionSpec[] = [
    { kbd: "Ctrl+N", Icon: FilePlus, label: t("welcome.actions.newFile"), onClick: () => newTab() },
    { kbd: "Ctrl+O", Icon: FileText, label: t("welcome.actions.openFile"), onClick: handleOpenFile },
    { kbd: "Ctrl+K O", Icon: FolderOpen, label: t("welcome.actions.openFolder"), onClick: handleOpenFolder },
  ];

  const greetingText = (() => {
    switch (greetingKey()) {
      case "night": return t("welcome.greeting.night");
      case "morning": return t("welcome.greeting.morning");
      case "afternoon": return t("welcome.greeting.afternoon");
      default: return t("welcome.greeting.evening");
    }
  })();

  return (
    <section className="daisu-welcome" aria-label={t("welcome.aria")}>
      <div className="daisu-welcome-inner">
        <header>
          <div className="daisu-welcome-mark">
            <span className="daisu-welcome-glyph" aria-hidden="true">
              大
            </span>
            <span className="daisu-welcome-wordmark">daisu</span>
          </div>
          <p className="daisu-welcome-greeting">{greetingText}</p>
        </header>

        {scratchCount > 0 && (
          <button
            type="button"
            className="daisu-welcome-recover"
            onClick={() => {
              const n = recoverScratch();
              setScratchCount(0);
              pushToast({
                message: t("welcome.scratchRecovered", { count: n }),
                level: "success",
              });
            }}
          >
            <ArrowCounterClockwise size={13} />
            {t("welcome.actions.recoverScratch", { count: scratchCount })}
          </button>
        )}

        <div className="daisu-welcome-actions">
          {actions.map((a) => (
            <button
              key={a.kbd}
              type="button"
              className="daisu-welcome-action"
              onClick={() => void a.onClick()}
            >
              <span className="daisu-welcome-action-icon">
                <a.Icon size={16} />
              </span>
              <span className="daisu-welcome-action-label">{a.label}</span>
              <span className="daisu-welcome-action-kbd">{a.kbd}</span>
            </button>
          ))}
        </div>

        {recents.length > 0 && (
          <div>
            <p className="daisu-welcome-section-title">
              <span className="daisu-glyph" aria-hidden="true">履</span>
              {t("welcome.recents")}
            </p>
            <div className="daisu-welcome-recents">
              {recents.slice(0, 5).map((r) => (
                <button
                  key={r.path}
                  type="button"
                  className="daisu-welcome-recent"
                  onClick={() => {
                    void openWorkspace(r.path).catch((e) =>
                      pushToast({ message: String(e), level: "error" }),
                    );
                  }}
                >
                  <span className="daisu-welcome-recent-name">{r.name}</span>
                  <span className="daisu-welcome-recent-path">{r.path}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <figure className="daisu-welcome-haiku">
          <p className="daisu-welcome-haiku-jp" aria-hidden="true">{HAIKU_JP[haikuIdx]}</p>
          <blockquote className="daisu-welcome-haiku-es">{haikuTranslation(t, haikuIdx)}</blockquote>
          <figcaption className="daisu-welcome-haiku-author">— {HAIKU_AUTHORS[haikuIdx]}</figcaption>
        </figure>
      </div>
    </section>
  );
}
