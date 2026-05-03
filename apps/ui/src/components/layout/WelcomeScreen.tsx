import type { JSX } from "react";
import { useCallback, useMemo, useState } from "react";
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

interface Haiku {
  jp: string;
  es: string;
  author: string;
}

// Selección curada de haiku clásicos. Uno por día (determinístico). El idioma
// japonés es referencia visual; la traducción al español lleva el peso.
const HAIKUS: Haiku[] = [
  { jp: "古池や蛙飛びこむ水の音", es: "viejo estanque — una rana salta, sonido del agua.", author: "Bashō" },
  { jp: "閑さや岩にしみ入る蝉の声", es: "tal silencio — la voz de las cigarras penetra la roca.", author: "Bashō" },
  { jp: "雀の子そこのけそこのけお馬が通る", es: "fuera, gorrioncito — viene pasando el caballo.", author: "Issa" },
  { jp: "やせ蛙負けるな一茶これにあり", es: "rana flaca — no te rindas, Issa está contigo.", author: "Issa" },
  { jp: "朝顔につるべ取られてもらひ水", es: "una enredadera tomó el balde — pido agua prestada.", author: "Chiyo-ni" },
  { jp: "菜の花や月は東に日は西に", es: "campo de mostaza — la luna al este, el sol al oeste.", author: "Buson" },
  { jp: "目には青葉山ほととぎす初鰹", es: "hojas verdes a la vista, cuco en la montaña, primer bonito.", author: "Sodō" },
  { jp: "夏草や兵どもが夢の跡", es: "hierba de verano — todo lo que queda del sueño de los guerreros.", author: "Bashō" },
  { jp: "雪とけて村いっぱいの子どもかな", es: "se derrite la nieve — el pueblo lleno de niños.", author: "Issa" },
  { jp: "我と来て遊べや親のない雀", es: "ven, juega conmigo — gorrión sin padres.", author: "Issa" },
  { jp: "柿くへば鐘が鳴るなり法隆寺", es: "comiendo un caqui — suenan las campanas de Hōryū-ji.", author: "Shiki" },
  { jp: "この道や行く人なしに秋の暮", es: "este camino — nadie lo recorre, atardecer de otoño.", author: "Bashō" },
];

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "buenas noches — momento tranquilo para escribir";
  if (h < 12) return "buenos días — café y un editor que no se mete en el medio";
  if (h < 19) return "buenas tardes — bienvenido de vuelta";
  return "buenas noches — código y silencio";
}

export function WelcomeScreen(): JSX.Element {
  const newTab = useTabs((s) => s.newTab);
  const openTab = useTabs((s) => s.openTab);
  const recoverScratch = useTabs((s) => s.recoverScratchUntitled);
  const openWorkspace = useWorkspace((s) => s.openWorkspace);
  const recents = useWorkspace((s) => s.recents);
  const pushToast = useUI((s) => s.pushToast);
  const haiku = useMemo(() => HAIKUS[dayOfYear(new Date()) % HAIKUS.length]!, []);
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
    { kbd: "Ctrl+N", Icon: FilePlus, label: "Nuevo archivo", onClick: () => newTab() },
    { kbd: "Ctrl+O", Icon: FileText, label: "Abrir archivo", onClick: handleOpenFile },
    { kbd: "Ctrl+K O", Icon: FolderOpen, label: "Abrir carpeta", onClick: handleOpenFolder },
  ];

  const greetingText = useMemo(greeting, []);

  return (
    <section className="daisu-welcome" aria-label="Pantalla de bienvenida">
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
                message: `${n} pestaña(s) Untitled recuperada(s)`,
                level: "success",
              });
            }}
          >
            <ArrowCounterClockwise size={13} />
            Recuperar {scratchCount} pestaña(s) sin guardar
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
              Recientes
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
          <p className="daisu-welcome-haiku-jp" aria-hidden="true">{haiku.jp}</p>
          <blockquote className="daisu-welcome-haiku-es">{haiku.es}</blockquote>
          <figcaption className="daisu-welcome-haiku-author">— {haiku.author}</figcaption>
        </figure>
      </div>
    </section>
  );
}
