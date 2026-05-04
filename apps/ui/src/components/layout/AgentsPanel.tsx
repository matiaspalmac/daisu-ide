import type { ChangeEvent, JSX, KeyboardEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, FileText, ClockCounterClockwise, ChatCenteredDots } from "@phosphor-icons/react";
import { useUI } from "../../stores/uiStore";

const HEADER_BTN =
  "w-6 h-6 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] rounded-[var(--radius-sm)] transition-colors";

export function AgentsPanel(): JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const pushToast = useUI((s) => s.pushToast);
  const canSend = text.trim().length > 0;

  const send = (): void => {
    if (!canSend) return;
    pushToast({
      message: t("chat.comingM4"),
      level: "info",
    });
    setText("");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <aside
      className="daisu-agents-panel h-full flex flex-col bg-[var(--bg-panel)] border-l border-[var(--border-subtle)]"
      aria-label={t("chat.panelAria")}
    >
      <header className="daisu-agents-header h-9 px-3 flex items-center justify-between border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-[0.08em] text-[var(--fg-secondary)]">
        <span className="flex items-center">
          <span className="daisu-glyph" aria-hidden="true">話</span>
          {t("chat.label")}
        </span>
        <div className="flex items-center gap-0.5">
          <button type="button" title={t("chat.newConversation")} aria-label={t("chat.newConversation")} className={HEADER_BTN}>
            <ChatCenteredDots size={13} />
          </button>
          <button type="button" title={t("chat.history")} aria-label={t("chat.history")} className={HEADER_BTN}>
            <ClockCounterClockwise size={13} />
          </button>
          <button
            type="button"
            title={t("chat.providerSettings")}
            aria-label={t("chat.providerSettings")}
            onClick={() => useUI.getState().setRightPanelMode("config")}
            className={HEADER_BTN}
          >
            <FileText size={13} />
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 grid place-items-center px-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <h3 className="text-sm font-medium text-[var(--fg-primary)]">
            {t("chat.startConversation")}
          </h3>
          <p className="text-xs text-[var(--fg-secondary)] max-w-[240px]">
            {t("chat.startHint")}
          </p>
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)] p-3">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-2 flex items-end gap-2 focus-within:border-[var(--border-strong)]">
          <textarea
            value={text}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
              setText(e.target.value);
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
            }}
            onKeyDown={onKey}
            placeholder={t("chat.placeholderShort")}
            rows={1}
            className="flex-1 bg-transparent border-0 outline-none resize-none text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] max-h-32 overflow-y-auto"
          />
          <button
            type="button"
            disabled={!canSend}
            aria-disabled={!canSend}
            aria-label={t("chat.send")}
            onClick={send}
            className="w-7 h-7 grid place-items-center bg-[var(--warn)] text-[var(--fg-inverse)] rounded-[var(--radius-sm)] hover:bg-[var(--warn-bright)] shadow-[var(--glow-orange-sm)] disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed"
          >
            <ArrowUp size={14} weight="bold" />
          </button>
        </div>
      </div>
    </aside>
  );
}
