import { useEffect, useRef, useState, type JSX, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ChatCircle,
  Plus,
  Trash,
  Stop,
  PaperPlaneRight,
  WarningCircle,
  Wrench,
  CaretRight,
  CaretDown,
  CheckCircle,
  XCircle,
} from "@phosphor-icons/react";
import {
  useAgent,
  type ChatMessage,
  type ToolBlock,
  type ChatMode,
} from "../../stores/agentStore";
import { useWorkspace } from "../../stores/workspaceStore";
import { PermissionInline } from "./PermissionModal";
import { ModelInlinePicker } from "./ModelInlinePicker";

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
  const chatMode = useAgent((s) => s.chatMode);
  const setChatMode = useAgent((s) => s.setChatMode);

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
        <ModelInlinePicker />
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
          <MessageView key={m.id} message={m} t={t} />
        ))}
        {error && (
          <div className="daisu-agent-error" role="alert">
            <WarningCircle size={12} weight="fill" />
            {error}
          </div>
        )}
      </div>

      <PermissionInline />

      <form className="daisu-agent-composer" onSubmit={handleSubmit}>
        <div
          className="daisu-agent-mode-row"
          role="radiogroup"
          aria-label={t("chat.modePickerLabel")}
        >
          {(["auto", "chat", "agent", "plan"] as const).map((m) => (
            <ModeButton
              key={m}
              mode={m}
              active={chatMode === m}
              onPick={setChatMode}
            />
          ))}
        </div>
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

interface ModeButtonProps {
  mode: ChatMode;
  active: boolean;
  onPick: (m: ChatMode) => void;
}

// Static key map keeps i18next's typed key union happy. Using a template
// literal would force `t()` into the dynamic-string overload that
// CustomTypeOptions disables.
const MODE_LABEL_KEYS = {
  auto: "chat.modeAuto",
  chat: "chat.modeChat",
  agent: "chat.modeAgent",
  plan: "chat.modePlan",
} as const;
const MODE_TIP_KEYS = {
  auto: "chat.modeAutoTip",
  chat: "chat.modeChatTip",
  agent: "chat.modeAgentTip",
  plan: "chat.modePlanTip",
} as const;

function ModeButton({ mode, active, onPick }: ModeButtonProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={`daisu-agent-mode${active ? " is-active" : ""}`}
      title={t(MODE_TIP_KEYS[mode])}
      onClick={() => onPick(mode)}
    >
      {t(MODE_LABEL_KEYS[mode])}
    </button>
  );
}

interface MessageViewProps {
  message: ChatMessage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}

function MessageView({ message: m, t }: MessageViewProps): JSX.Element {
  return (
    <article
      className={`daisu-agent-msg is-${m.role}${m.pending ? " is-pending" : ""}`}
      aria-live={m.pending ? "polite" : undefined}
    >
      <header className="daisu-agent-msg-role">
        {t(`chat.roles.${m.role}`, { defaultValue: m.role })}
      </header>
      {m.content && <div className="daisu-agent-msg-body">{m.content}</div>}
      {!m.content && !m.toolCalls?.length && (
        <div className="daisu-agent-msg-body">…</div>
      )}
      {m.toolCalls?.map((c) => (
        <ToolBlockView key={c.id} block={c} t={t} />
      ))}
      {m.warning && (
        <p className="daisu-agent-msg-warn">
          <WarningCircle size={11} weight="fill" /> {m.warning}
        </p>
      )}
    </article>
  );
}

interface ToolBlockViewProps {
  block: ToolBlock;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}

function ToolBlockView({ block, t }: ToolBlockViewProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const status = block.status;
  const ok = block.result?.ok ?? null;
  const Icon = expanded ? CaretDown : CaretRight;
  return (
    <div
      className={`daisu-agent-toolcall is-${status}${
        ok === false ? " is-failed" : ""
      }`}
    >
      <button
        type="button"
        className="daisu-agent-toolcall-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <Icon size={11} />
        <Wrench size={12} />
        <span className="daisu-agent-toolcall-name">{block.name}</span>
        {status === "running" && (
          <span className="daisu-agent-toolcall-state">
            {t("chat.toolRunning", { defaultValue: "calling…" })}
          </span>
        )}
        {status === "done" && (
          <span className="daisu-agent-toolcall-state">
            {t("chat.toolPending", { defaultValue: "awaiting result" })}
          </span>
        )}
        {status === "result" && ok && (
          <CheckCircle size={11} weight="fill" className="text-success" />
        )}
        {status === "result" && ok === false && (
          <XCircle size={11} weight="fill" className="text-warn" />
        )}
      </button>
      {expanded && (
        <div className="daisu-agent-toolcall-body">
          <pre className="daisu-agent-toolcall-args">
            {block.argsJson || "{}"}
          </pre>
          {block.result && (
            <pre className="daisu-agent-toolcall-result">
              {typeof block.result.output === "string"
                ? block.result.output
                : JSON.stringify(block.result.output, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
