import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Crosshair, List, Minus, Square, User, X } from "@phosphor-icons/react";
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

type PeriodKey = "morning" | "afternoon" | "evening" | "night";

function periodInfo(d: Date): { glyph: string; key: PeriodKey } {
  const h = d.getHours();
  if (h >= 5 && h < 12) return { glyph: "朝", key: "morning" };
  if (h >= 12 && h < 18) return { glyph: "昼", key: "afternoon" };
  if (h >= 18 && h < 21) return { glyph: "夕", key: "evening" };
  return { glyph: "夜", key: "night" };
}
function formatClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function TitleBar(): JSX.Element {
  const { t } = useTranslation();
  const openSettings = useUI((s) => s.openSettings);
  const toggleSearch = useUI((s) => s.toggleSearchPanel);
  const pushToast = useUI((s) => s.pushToast);
  const newTab = useTabs((s) => s.newTab);
  const openTab = useTabs((s) => s.openTab);
  const saveActive = useTabs((s) => s.saveActive);
  const openWorkspace = useWorkspace((s) => s.openWorkspace);
  const focusMode = useUI((s) => s.focusMode);
  const toggleFocusMode = useUI((s) => s.toggleFocusMode);
  const design = useSettings((s) => s.settings.design);

  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const clock = formatClock(now);
  const period = periodInfo(now);
  const periodLabel = t(`titlebar.period.${period.key}`);

  const handleOpen = useCallback(async (): Promise<void> => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: t("menu.openFile"),
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
      pushToast({ message: t("common.saved"), level: "success" });
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  }, [saveActive, pushToast, t]);

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
      className="h-[var(--titlebar-h)] bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] flex items-stretch text-[12px] text-[var(--fg-secondary)] select-none relative"
    >
      {/* Hamburger */}
      {design.titleBarHamburger && (
        <button
          type="button"
          className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)]"
          onClick={() => openSettings()}
          title={t("titlebar.menu")}
          aria-label={t("titlebar.menu")}
        >
          <List size={14} />
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
              {t("menu.file")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => newTab()}>
              {t("menu.newFile")}
              <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleOpen()}>
              {t("menu.openFile")}
              <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleOpenFolder()}>
              {t("menu.openFolder")}
              <DropdownMenuShortcut>Ctrl+K O</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void handleSave()}>
              {t("menu.save")}
              <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void win?.close()}>
              {t("menu.exit")}
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
              {t("menu.edit")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled>
              {t("menu.undo")}
              <DropdownMenuShortcut>Ctrl+Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              {t("menu.redo")}
              <DropdownMenuShortcut>Ctrl+Y</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              {t("menu.cut")}
              <DropdownMenuShortcut>Ctrl+X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              {t("menu.copy")}
              <DropdownMenuShortcut>Ctrl+C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              {t("menu.paste")}
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
              {t("menu.selection")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled>
              {t("menu.selectAll")}
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
              {t("menu.view")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => useUI.getState().toggleSidebar()}>
              {t("menu.toggleSidebar")}
              <DropdownMenuShortcut>Ctrl+B</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toggleSearch()}>
              {t("menu.toggleSearch")}
              <DropdownMenuShortcut>Ctrl+Shift+F</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useUI.getState().toggleAgentsPanel()}>
              {t("menu.toggleChatPanel")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openSettings()}>
              {t("menu.settings")}
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
              {t("menu.terminal")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled>{t("common.comingSoon")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      )}

      {/* Centered clock — absolute so it stays centered regardless of side widths */}
      <div
        className="daisu-titlebar-clock"
        title={`${periodLabel} — ${clock}`}
        aria-label={t("titlebar.clockLabel", { clock, period: periodLabel })}
      >
        <span className="daisu-titlebar-clock-glyph" aria-hidden="true">{period.glyph}</span>
        <span className="daisu-titlebar-clock-time">{clock}</span>
      </div>

      {/* Drag spacer */}
      <div className="flex-1" data-tauri-drag-region />

      {/* Focus mode toggle */}
      <button
        type="button"
        className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)]"
        onClick={() => toggleFocusMode()}
        title={focusMode ? t("titlebar.focusExit") : t("titlebar.focusEnter")}
        aria-label={t("titlebar.focusLabel")}
        aria-pressed={focusMode}
      >
        {focusMode ? <span className="daisu-glyph" style={{ fontSize: 14, opacity: 1 }}>静</span> : <Crosshair size={13} />}
      </button>

      {/* User avatar — placeholder */}
      {design.titleBarUserAvatar && (
        <button
          type="button"
          className="w-8 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)]"
          title={t("titlebar.account")}
          aria-label={t("titlebar.account")}
        >
          <User size={14} />
        </button>
      )}

      {/* Window controls */}
      <button
        type="button"
        className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--accent-soft)]"
        onClick={() => void win?.minimize()}
        aria-label={t("titlebar.minimize")}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--accent-soft)]"
        onClick={() => void win?.toggleMaximize()}
        aria-label={t("titlebar.maximize")}
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        className="w-10 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--fg-inverse)] hover:bg-[var(--danger)]"
        onClick={() => void win?.close()}
        aria-label={t("titlebar.close")}
      >
        <X size={14} />
      </button>
    </header>
  );
}
