import type { JSX } from "react";
import { useState } from "react";
import { ArrowUp, ChevronDown, Globe, Hash, History, MessageSquarePlus, Sparkles } from "lucide-react";

const HEADER_BTN =
  "w-6 h-6 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] rounded-[var(--radius-sm)] transition-colors";

export function AgentsPanel(): JSX.Element {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0;

  return (
    <aside
      className="daisu-agents-panel h-full flex flex-col bg-[var(--bg-panel)] border-l border-[var(--border-subtle)]"
      aria-label="Chat panel"
    >
      <header className="h-9 px-3 flex items-center justify-between border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-[0.08em] text-[var(--fg-secondary)]">
        <span>Chat</span>
        <div className="flex items-center gap-0.5">
          <button type="button" title="Nueva conversación" aria-label="Nueva conversación" className={HEADER_BTN}>
            <MessageSquarePlus size={13} />
          </button>
          <button type="button" title="Historial" aria-label="Historial" className={HEADER_BTN}>
            <History size={13} />
          </button>
          <button type="button" title="Configuración" aria-label="Configuración" className={HEADER_BTN}>
            <Sparkles size={13} />
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 grid place-items-center px-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <h3 className="text-sm font-medium text-[var(--fg-primary)]">
            Comienza una conversación
          </h3>
          <p className="text-xs text-[var(--fg-secondary)] max-w-[240px]">
            Escribe un mensaje para comenzar a chatear con la IA
          </p>
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)] p-3 flex flex-col gap-2">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-2 flex items-end gap-2 focus-within:border-[var(--border-strong)]">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe un mensaje..."
            rows={1}
            className="flex-1 bg-transparent border-0 outline-none resize-none text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] max-h-32"
          />
          <button
            type="button"
            disabled={!canSend}
            aria-label="Enviar"
            className="w-7 h-7 grid place-items-center bg-[var(--warn)] text-[var(--fg-inverse)] rounded-[var(--radius-sm)] hover:bg-[var(--warn-bright)] shadow-[var(--glow-orange-sm)] disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed"
          >
            <ArrowUp size={14} strokeWidth={2} />
          </button>
        </div>

        <button
          type="button"
          className="self-start inline-flex items-center gap-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-full px-2.5 py-1"
        >
          <Hash size={11} className="text-[var(--fg-muted)]" />
          <Globe size={11} className="text-[var(--accent)]" />
          <span className="font-mono">tencent/hy3-preview:free</span>
          <ChevronDown size={11} />
        </button>
      </div>
    </aside>
  );
}
