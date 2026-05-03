import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
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

interface Tip {
  title: string;
  body: string;
}

const TIPS: Tip[] = [
  {
    title: "Ctrl+Shift+P abre la paleta",
    body: "Todo el IDE a un atajo. Escribí lo que necesitás hacer.",
  },
  {
    title: "Ctrl+B alterna la barra lateral",
    body: "Maximiza el editor cuando necesites concentrarte.",
  },
  {
    title: "Ctrl+/ comenta líneas",
    body: "Comenta o descomenta sin escribir símbolos.",
  },
  {
    title: "Ctrl+Shift+F busca en el proyecto",
    body: "Busca cualquier texto en todo el workspace.",
  },
  {
    title: "F2 renombra archivos",
    body: "Selecciona en el árbol y presiona F2 para renombrar.",
  },
  {
    title: "Tabs arrastrables",
    body: "Reordená pestañas arrastrándolas dentro de la barra.",
  },
];

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
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [scratchCount, setScratchCount] = useState(() => getScratchUntitled().length);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTipIdx((i) => (i + 1) % TIPS.length);
    }, 12000);
    return () => window.clearInterval(id);
  }, []);

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

  const tip = TIPS[tipIdx]!;
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

        <p className="daisu-welcome-tip" aria-live="polite">
          <span className="daisu-welcome-tip-prefix" aria-hidden="true">訓</span>
          <span className="sr-only">tip:</span>
          {tip.title}. <span style={{ color: "var(--fg-muted)" }}>{tip.body}</span>
        </p>
      </div>
    </section>
  );
}
