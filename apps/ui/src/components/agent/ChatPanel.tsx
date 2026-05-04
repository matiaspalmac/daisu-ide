import { useEffect, useRef, useState, type JSX, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ChatCircle,
  Plus,
  Trash,
  Stop,
  PaperPlaneRight,
  WarningCircle,
} from "@phosphor-icons/react";
import { useAgent } from "../../stores/agentStore";
import { useWorkspace } from "../../stores/workspaceStore";

export function ChatPanel(): JSX.Element {
  const { t } = useTranslation();
  const rootPath = useWorkspace((s) => s.rootPath);
  const conversations = useAgent((s) => s.conversations);
  const activeConvoId = useAgent((s) => s.activeConvoId);
  const messages = useAgent((s) => s.messages);
  const isStreaming = useAgent((s) => s.isStreaming);
  const error = useAgent((s) => s.error);
  const setWorkspace = useAgent((s) => s.setWorkspace);
  const select = useAgent((s) => s.selectConversation);
  const create = useAgent((s) => s.createConversation);
  const remove = useAgent((s) => s.deleteConversation);
  const sendMessage = useAgent((s) => s.sendMessage);
  const cancel = useAgent((s) => s.cancel);
  const attach = useAgent((s) => s.attachListener);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void attach();
  }, [attach]);

  useEffect(() => {
    void setWorkspace(rootPath);
  }, [rootPath, setWorkspace]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    const text = draft.trim();
    if (!text || isStreaming) return;
    setDraft("");
    void sendMessage(text);
  }

  if (!rootPath) {
    return (
      <div className="daisu-agent-empty">
        <span className="daisu-glyph" aria-hidden="true">話</span>
        <p>{t("chat.openFolderHint")}</p>
      </div>
    );
  }

  return (
    <div className="daisu-agent-panel">
      <header className="daisu-agent-header">
        <div className="daisu-agent-title">
          <span className="daisu-glyph" aria-hidden="true">話</span>
          <span>{t("chat.title")}</span>
        </div>
        <button
          type="button"
          className="daisu-icon-btn"
          aria-label={t("chat.newConversation")}
          title={t("chat.newConversation")}
          onClick={() => void create()}
        >
          <Plus size={14} />
        </button>
      </header>

      {conversations.length > 0 && (
        <div className="daisu-agent-convos">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`daisu-agent-convo${
                c.id === activeConvoId ? " is-active" : ""
              }`}
            >
              <button
                type="button"
                className="daisu-agent-convo-btn"
                onClick={() => void select(c.id)}
                title={c.title}
              >
                <ChatCircle size={12} />
                <span className="daisu-agent-convo-title">{c.title}</span>
              </button>
              <button
                type="button"
                className="daisu-icon-btn"
                aria-label={t("chat.deleteConversation")}
                title={t("chat.deleteConversation")}
                onClick={() => void remove(c.id)}
              >
                <Trash size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="daisu-agent-messages">
        {messages.length === 0 && (
          <p className="daisu-agent-empty-hint">
            {t("chat.emptyConversation")}
          </p>
        )}
        {messages.map((m) => (
          <article
            key={m.id}
            className={`daisu-agent-msg is-${m.role}${
              m.pending ? " is-pending" : ""
            }`}
            aria-live={m.pending ? "polite" : undefined}
          >
            <header className="daisu-agent-msg-role">{t(`chat.roles.${m.role}`, { defaultValue: m.role })}</header>
            <div className="daisu-agent-msg-body">{m.content || "…"}</div>
            {m.warning && (
              <p className="daisu-agent-msg-warn">
                <WarningCircle size={11} weight="fill" /> {m.warning}
              </p>
            )}
          </article>
        ))}
        {error && (
          <div className="daisu-agent-error" role="alert">
            <WarningCircle size={12} weight="fill" />
            {error}
          </div>
        )}
      </div>

      <form className="daisu-agent-composer" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="agent-composer-input">
          {t("chat.messageLabel")}
        </label>
        <textarea
          id="agent-composer-input"
          className="daisu-agent-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder={t("chat.placeholder")}
          rows={3}
          disabled={isStreaming}
        />
        <div className="daisu-agent-composer-actions">
          {isStreaming ? (
            <button
              type="button"
              className="daisu-btn daisu-btn-danger"
              onClick={() => void cancel()}
              title={t("chat.cancelTooltip")}
            >
              <Stop size={12} weight="fill" />
              {t("chat.cancel")}
            </button>
          ) : (
            <button
              type="submit"
              className="daisu-btn daisu-btn-primary"
              disabled={!draft.trim()}
            >
              <PaperPlaneRight size={12} weight="fill" />
              {t("chat.send")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

