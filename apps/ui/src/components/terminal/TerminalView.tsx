import { useEffect, useRef, type JSX } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import {
  onTerminalExit,
  onTerminalOutput,
  terminalKill,
  terminalResize,
  terminalSpawn,
  terminalWrite,
} from "../../lib/terminal";
import { daisuNocturneTheme } from "./terminalTheme";

interface Props {
  cwd: string;
  onReady?: (id: string) => void;
  onExit?: () => void;
}

export function TerminalView({ cwd, onReady, onExit }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      theme: daisuNocturneTheme,
      fontFamily:
        '"JetBrainsMono Nerd Font", "Cascadia Code", Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowTransparency: false,
      scrollback: 5000,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new Unicode11Addon());
    term.loadAddon(new SearchAddon());
    term.unicode.activeVersion = "11";
    term.open(container);
    fit.fit();

    let unlistenOutput: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let ptyId: string | null = null;
    let disposed = false;

    void (async () => {
      const { rows, cols } = term;
      ptyId = await terminalSpawn({ cwd, cols, rows });
      if (disposed) {
        await terminalKill(ptyId);
        return;
      }
      onReady?.(ptyId);
      const decoder = new TextDecoder("utf-8", { fatal: false });
      unlistenOutput = await onTerminalOutput(ptyId, (chunk) => {
        term.write(decoder.decode(chunk, { stream: true }));
      });
      unlistenExit = await onTerminalExit(ptyId, () => {
        onExit?.();
      });
      term.onData((data) => {
        if (ptyId) void terminalWrite(ptyId, data);
      });
      term.onResize(({ cols: c, rows: r }) => {
        if (ptyId) void terminalResize(ptyId, c, r);
      });
    })();

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* container hidden */
      }
    });
    ro.observe(container);

    return () => {
      disposed = true;
      ro.disconnect();
      if (unlistenOutput) unlistenOutput();
      if (unlistenExit) unlistenExit();
      if (ptyId) void terminalKill(ptyId);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  return <div ref={containerRef} className="h-full w-full bg-[var(--bg-base)]" />;
}
