import type { JSX } from "react";
import { useCallback, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Menu, Minus, Square, User, X } from "lucide-react";
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
import { useSettings } from "../../stores/settingsStore";
import { translateError } from "../../lib/error-translate";

export function TitleBar(): JSX.Element {
  const openSettings = useUI((s) => s.openSettings);
  const toggleSearch = useUI((s) => s.toggleSearchPanel);
  const pushToast = useUI((s) => s.pushToast);
  const newTab = useTabs((s) => s.newTab);
  const openTab = useTabs((s) => s.openTab);
  const saveActive = useTabs((s) => s.saveActive);
  const openWorkspace = useWorkspace((s) => s.openWorkspace);
  const design = useSettings((s) => s.settings.design);

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

  // getCurrentWindow throws when running in a plain browser (vite dev opened
  // outside Tauri webview). Guard so the titlebar still renders for designers
  // previewing the UI in Chrome.
  const win = useMemo(() => {
    try {
      return getCurrentWindow();
    } catch {
      return null;
    }
  }, []);

  return (
    <header
      className="h-[var(--titlebar-h)] bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] flex items-stretch text-[12px] text-[var(--fg-secondary)] select-none"
    >
      {/* Hamburger */}
      {design.titleBarHamburger && (
        <button
          type="button"
          className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)]"
          onClick={() => openSettings()}
          title="Menú"
          aria-label="Menú"
        >
          <Menu size={14} strokeWidth={1.5} />
        </button>
      )}

      {/* Menu strip */}
      {design.titleBarMenuStrip && (
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
            <DropdownMenuItem onSelect={() => void win?.close()}>
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
      )}

      {/* Spacer (drag region) */}
      <div className="flex-1" data-tauri-drag-region />

      {/* User avatar — placeholder */}
      {design.titleBarUserAvatar && (
        <button
          type="button"
          className="w-8 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)]"
          title="Cuenta"
          aria-label="Cuenta"
        >
          <User size={14} strokeWidth={1.5} />
        </button>
      )}

      {/* Window controls */}
      <button
        type="button"
        className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--accent-soft)]"
        onClick={() => void win?.minimize()}
        aria-label="Minimizar"
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--accent-soft)]"
        onClick={() => void win?.toggleMaximize()}
        aria-label="Maximizar"
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--fg-inverse)] hover:bg-[var(--danger)]"
        onClick={() => void win?.close()}
        aria-label="Cerrar"
      >
        <X size={14} />
      </button>
    </header>
  );
}
