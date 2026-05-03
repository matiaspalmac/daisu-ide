import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { CornerDownRight, FileText, FilePlus, FolderOpen } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTabs } from "../../stores/tabsStore";
import { useUI } from "../../stores/uiStore";
import { useWorkspace } from "../../stores/workspaceStore";
import { translateError } from "../../lib/error-translate";

interface CardSpec {
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
    title: "Ctrl+Shift+P abre la paleta de comandos",
    body: "Accede a todas las funciones de Daisu escribiendo lo que necesitas hacer.",
  },
  {
    title: "Ctrl+/ comenta código rápidamente",
    body: "Comenta o descomenta líneas sin escribir los símbolos manualmente.",
  },
  {
    title: "Ctrl+B alterna la barra lateral",
    body: "Maximiza el área del editor cuando necesites concentrarte.",
  },
  {
    title: "Ctrl+Shift+F busca en todo el proyecto",
    body: "Busca cualquier texto a través de los archivos del workspace.",
  },
  {
    title: "Ctrl+W cierra la pestaña activa",
    body: "Cierra rápidamente la pestaña en la que estás trabajando.",
  },
  {
    title: "Tabs arrastrables",
    body: "Reordena tus pestañas arrastrándolas dentro de la barra de pestañas.",
  },
  {
    title: "Click derecho en explorador",
    body: "Abre el menú contextual con acciones de archivo (renombrar, eliminar, etc).",
  },
  {
    title: "F2 para renombrar",
    body: "Selecciona un archivo en el árbol y presiona F2 para renombrarlo en línea.",
  },
];

export function WelcomeScreen(): JSX.Element {
  const newTab = useTabs((s) => s.newTab);
  const openTab = useTabs((s) => s.openTab);
  const openWorkspace = useWorkspace((s) => s.openWorkspace);
  const pushToast = useUI((s) => s.pushToast);
  const [tipIdx, setTipIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setTipIdx((i) => (i + 1) % TIPS.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [paused]);

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

  const cards: CardSpec[] = [
    { kbd: "Ctrl+N", Icon: FilePlus, label: "Nuevo archivo", onClick: () => newTab() },
    { kbd: "Ctrl+O", Icon: FileText, label: "Abrir archivo", onClick: handleOpenFile },
    { kbd: "Ctrl+K O", Icon: FolderOpen, label: "Abrir carpeta", onClick: handleOpenFolder },
  ];

  const tip = TIPS[tipIdx]!;

  return (
    <section
      className="h-full grid place-items-center overflow-auto"
      style={{ backgroundImage: "var(--body-gradient)", backgroundColor: "var(--bg-base)" }}
    >
      <div
        className="flex flex-col items-center gap-12 py-12"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="grid grid-cols-3 gap-4">
          {cards.map((c) => (
            <button
              key={c.kbd}
              type="button"
              onClick={() => void c.onClick()}
              className="relative w-40 h-28 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 flex flex-col items-center justify-center gap-2 hover:border-[var(--border-strong)] hover:shadow-[var(--glow-cyan-sm)] transition-all"
            >
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/30 rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px]">
                <CornerDownRight size={9} />
                {c.kbd}
              </span>
              <c.Icon size={26} strokeWidth={1.2} className="text-[var(--fg-secondary)]" />
              <span className="text-sm text-[var(--fg-primary)]">{c.label}</span>
            </button>
          ))}
        </div>

        <div className="w-[512px] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">Consejos</span>
            <div className="flex gap-1">
              {TIPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setTipIdx(i)}
                  aria-label={`Tip ${i + 1}`}
                  aria-current={i === tipIdx ? "true" : undefined}
                  className="w-4 h-4 grid place-items-center group"
                >
                  <span
                    className={
                      "w-1.5 h-1.5 rounded-full transition-all " +
                      (i === tipIdx
                        ? "bg-[var(--accent)] shadow-[var(--glow-cyan-sm)]"
                        : "bg-[var(--fg-muted)]/40 group-hover:bg-[var(--fg-muted)]")
                    }
                  />
                </button>
              ))}
            </div>
          </div>
          <div
            aria-live="polite"
            className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 text-center"
          >
            <p className="text-sm text-[var(--fg-primary)]">{tip.title}</p>
            <p className="text-xs text-[var(--fg-secondary)] mt-1">{tip.body}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
