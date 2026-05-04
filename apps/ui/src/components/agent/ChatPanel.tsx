import { useEffect, useRef, useState, type JSX, type FormEvent } from "react";
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
        <p>Abrí una carpeta para empezar a conversar con el agente.</p>
      </div>
    );
  }

  return (
    <div className="daisu-agent-panel">
      <header className="daisu-agent-header">
        <div className="daisu-agent-title">
          <span className="daisu-glyph" aria-hidden="true">話</span>
          <span>Agente</span>
        </div>
        <button
          type="button"
          className="daisu-icon-btn"
          aria-label="Nueva conversación"
          title="Nueva conversación"
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
                aria-label="Eliminar conversación"
                title="Eliminar conversación"
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
            Escribí un mensaje abajo para comenzar.
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
            <header className="daisu-agent-msg-role">{labelForRole(m.role)}</header>
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
          Mensaje al agente
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
          placeholder="Pedile algo al agente. Enter envía, Shift+Enter salto de línea."
          rows={3}
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button
            type="button"
            className="daisu-btn daisu-btn-danger"
            onClick={() => void cancel()}
            title="Cancelar (Esc)"
          >
            <Stop size={12} weight="fill" />
            Cancelar
          </button>
        ) : (
          <button
            type="submit"
            className="daisu-btn daisu-btn-primary"
            disabled={!draft.trim()}
          >
            <PaperPlaneRight size={12} weight="fill" />
            Enviar
          </button>
        )}
      </form>
    </div>
  );
}

function labelForRole(role: string): string {
  switch (role) {
    case "user":
      return "Vos";
    case "assistant":
      return "Agente";
    case "tool":
      return "Tool";
    default:
      return role;
  }
}
