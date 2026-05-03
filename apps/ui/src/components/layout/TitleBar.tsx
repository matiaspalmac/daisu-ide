import type { JSX } from "react";
import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  Minus,
  Search,
  Square,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUI } from "../../stores/uiStore";
import { useTabs } from "../../stores/tabsStore";
import { useWorkspace } from "../../stores/workspaceStore";
import { translateError } from "../../lib/error-translate";

function workspaceName(rootPath: string | null): string {
  if (!rootPath) return "Sin proyecto";
  const parts = rootPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? rootPath;
}

export function TitleBar(): JSX.Element {
  const openSettings = useUI((s) => s.openSettings);
  const toggleSearch = useUI((s) => s.toggleSearchPanel);
  const pushToast = useUI((s) => s.pushToast);
  const newTab = useTabs((s) => s.newTab);
  const openTab = useTabs((s) => s.openTab);
  const saveActive = useTabs((s) => s.saveActive);
  const openWorkspace = useWorkspace((s) => s.openWorkspace);
  const rootPath = useWorkspace((s) => s.rootPath);

  const handleOpen = useCallback(async (): Promise<void> => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: "Open file",
      });
      if (typeof selected === "string") {
        await openTab(selected);
      }
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  }, [openTab, pushToast]);

  const handleOpenFolder = useCallback(async (): Promise<void> => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await openWorkspace(selected);
      }
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  }, [openWorkspace, pushToast]);

  const handleSave = useCallback(async (): Promise<void> => {
    try {
      await saveActive();
      pushToast({ message: "Guardado", level: "success" });
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  }, [saveActive, pushToast]);

  const win = getCurrentWindow();

  return (
    <header
      data-tauri-drag-region
      className="h-[var(--titlebar-h)] bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] flex items-stretch text-[12px] text-[var(--fg-secondary)] select-none"
    >
      {/* Hamburger */}
      <button
        type="button"
        className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)]"
        onClick={() => openSettings()}
        title="Menú"
        aria-label="Menú"
      >
        <Menu size={14} strokeWidth={1.5} />
      </button>

      {/* Menu strip */}
      <nav className="flex items-stretch">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="px-3 hover:text-[var(--fg-primary)] hover:bg-[var(--accent-soft)]"
            >
              Archivo
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => newTab()}>
              Nuevo archivo
              <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleOpen()}>
              Abrir archivo…
              <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleOpenFolder()}>
              Abrir carpeta…
              <DropdownMenuShortcut>Ctrl+K O</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void handleSave()}>
              Guardar
              <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void win.close()}>
              Salir
              <DropdownMenuShortcut>Alt+F4</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="px-3 hover:text-[var(--fg-primary)] hover:bg-[var(--accent-soft)]"
            >
              Edición
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled>
              Deshacer
              <DropdownMenuShortcut>Ctrl+Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              Rehacer
              <DropdownMenuShortcut>Ctrl+Y</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              Cortar
              <DropdownMenuShortcut>Ctrl+X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              Copiar
              <DropdownMenuShortcut>Ctrl+C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              Pegar
              <DropdownMenuShortcut>Ctrl+V</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="px-3 hover:text-[var(--fg-primary)] hover:bg-[var(--accent-soft)]"
            >
              Selección
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled>
              Seleccionar todo
              <DropdownMenuShortcut>Ctrl+A</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="px-3 hover:text-[var(--fg-primary)] hover:bg-[var(--accent-soft)]"
            >
              Vista
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => useUI.getState().toggleSidebar()}>
              Alternar barra lateral
              <DropdownMenuShortcut>Ctrl+B</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toggleSearch()}>
              Alternar buscar
              <DropdownMenuShortcut>Ctrl+Shift+F</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useUI.getState().toggleAgentsPanel()}>
              Alternar panel chat
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openSettings()}>
              Configuración
              <DropdownMenuShortcut>Ctrl+,</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="px-3 hover:text-[var(--fg-primary)] hover:bg-[var(--accent-soft)]"
            >
              Terminal
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled>Próximamente</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      {/* Workspace breadcrumb */}
      <div className="flex items-center gap-1 px-3 ml-2 text-[var(--fg-muted)]">
        <ChevronLeft size={11} />
        <span className="text-[var(--fg-primary)]">{workspaceName(rootPath)}</span>
        <ChevronRight size={11} />
      </div>

      {/* Spacer */}
      <div className="flex-1" data-tauri-drag-region />

      {/* Command palette pill */}
      <button
        type="button"
        className="self-center mx-2 inline-flex items-center gap-2 h-6 px-3 rounded-[var(--radius-pill)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--fg-muted)] hover:border-[var(--border-strong)]"
        onClick={() =>
          pushToast({
            message: "Paleta de comandos disponible en M3",
            level: "info",
          })
        }
        title="Paleta de comandos"
      >
        <Search size={11} />
        <span>Barra de comandos</span>
        <span className="font-mono text-[10px] opacity-60 ml-2">Ctrl+Shift+P</span>
      </button>

      {/* Spacer right */}
      <div className="flex-1" data-tauri-drag-region />

      {/* Sign-in CTA — disabled */}
      <Button
        variant="warn"
        size="sm"
        disabled
        className="self-center mr-2"
        title="Próximamente"
      >
        Iniciar Sesión
      </Button>

      {/* User avatar — placeholder */}
      <button
        type="button"
        className="w-8 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)]"
        title="Cuenta"
        aria-label="Cuenta"
      >
        <User size={14} strokeWidth={1.5} />
      </button>

      {/* Window controls */}
      <button
        type="button"
        className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--accent-soft)]"
        onClick={() => void win.minimize()}
        aria-label="Minimizar"
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--accent-soft)]"
        onClick={() => void win.toggleMaximize()}
        aria-label="Maximizar"
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--fg-inverse)] hover:bg-[var(--danger)]"
        onClick={() => void win.close()}
        aria-label="Cerrar"
      >
        <X size={14} />
      </button>
    </header>
  );
}
