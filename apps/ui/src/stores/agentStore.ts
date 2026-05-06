import { create } from "zustand";
import {
  AGENT_STREAM_EVENT,
  type ConversationSummary,
  type StoredMessage,
  type StreamPayload,
  cancelRun,
  createConversation,
  deleteConversation,
  getMessages,
  listConversations,
  sendMessage,
} from "../lib/agent";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSettings } from "./settingsStore";
import i18n from "../i18n";

export interface ToolBlock {
  /** Provider-issued id used to correlate args + result. */
  id: string;
  name: string;
  /** JSON args (parsed when complete, partial during streaming). */
  argsJson: string;
  status: "running" | "done" | "result";
  result?: {
    ok: boolean;
    output: unknown;
  };
  /** Wall-clock millis when ToolUseStart fired. */
  startedAt?: number;
  /** Wall-clock millis when args streaming finished (ToolUseDone). */
  argsAt?: number;
  /** Wall-clock millis when ToolResult arrived. */
  completedAt?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  pending?: boolean;
  warning?: string;
  /** Tool calls the assistant emitted in this turn. UI renders these
   *  inline with the assistant's text. Tool results are rendered as
   *  separate messages with role="tool". */
  toolCalls?: ToolBlock[];
}

/**
 * Conversation mode the user picks in the composer:
 *  - `auto`: heuristic decides whether to advertise tools (default).
 *  - `chat`: tools never advertised, model answers in plain text.
 *  - `agent`: full tool access, heuristic disabled.
 *  - `plan`: read-only tools only, plan-first system prompt addendum.
 */
export type ChatMode = "auto" | "chat" | "agent" | "plan";

interface AgentState {
  conversations: ConversationSummary[];
  activeConvoId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  runId: string | null;
  error: string | null;
  workspacePath: string | null;
  chatMode: ChatMode;

  setWorkspace: (path: string | null) => Promise<void>;
  refreshConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: (title?: string) => Promise<string | null>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  attachListener: () => Promise<UnlistenFn>;
  setChatMode: (mode: ChatMode) => void;
}

let listenerRef: Promise<UnlistenFn> | null = null;

const CHAT_MODE_STORAGE_KEY = "daisu:chat-mode";
function loadStoredChatMode(): ChatMode {
  try {
    const v = localStorage.getItem(CHAT_MODE_STORAGE_KEY);
    if (v === "chat" || v === "agent" || v === "plan" || v === "auto") {
      return v;
    }
  } catch {
    /* localStorage may be unavailable in tests */
  }
  return "auto";
}

export const useAgent = create<AgentState>((set, get) => ({
  conversations: [],
  activeConvoId: null,
  messages: [],
  isStreaming: false,
  runId: null,
  error: null,
  workspacePath: null,
  chatMode: loadStoredChatMode(),

  setChatMode: (mode) => {
    set({ chatMode: mode });
    try {
      localStorage.setItem(CHAT_MODE_STORAGE_KEY, mode);
    } catch {
      /* noop */
    }
  },

  setWorkspace: async (path) => {
    set({
      workspacePath: path,
      conversations: [],
      activeConvoId: null,
      messages: [],
      error: null,
    });
    if (path) await get().refreshConversations();
  },

  refreshConversations: async () => {
    const ws = get().workspacePath;
    if (!ws) return;
    try {
      const list = await listConversations(ws);
      set({ conversations: list });
    } catch (e) {
      set({ error: String((e as Error).message ?? e) });
    }
  },

  selectConversation: async (id) => {
    const ws = get().workspacePath;
    if (!ws) return;
    try {
      const msgs = await getMessages(ws, id);
      set({
        activeConvoId: id,
        messages: msgs.map<ChatMessage>((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })),
        error: null,
      });
    } catch (e) {
      set({ error: String((e as Error).message ?? e) });
    }
  },

  createConversation: async (title) => {
    const ws = get().workspacePath;
    if (!ws) return null;
    const ai = useSettings.getState().settings.aiProvider;
    try {
      const id = await createConversation(
        ws,
        title ?? i18n.t("tabs.newConversation"),
        ai.id,
        ai.model,
      );
      await get().refreshConversations();
      await get().selectConversation(id);
      return id;
    } catch (e) {
      set({ error: String((e as Error).message ?? e) });
      return null;
    }
  },

  deleteConversation: async (id) => {
    const ws = get().workspacePath;
    if (!ws) return;
    try {
      await deleteConversation(ws, id);
      const isActive = get().activeConvoId === id;
      await get().refreshConversations();
      if (isActive) set({ activeConvoId: null, messages: [] });
    } catch (e) {
      set({ error: String((e as Error).message ?? e) });
    }
  },

  sendMessage: async (text) => {
    const ws = get().workspacePath;
    let convoId = get().activeConvoId;
    if (!ws) return;
    if (!convoId) {
      convoId = await get().createConversation(text.slice(0, 60));
      if (!convoId) return;
    }
    const ai = useSettings.getState().settings.aiProvider;
    const userMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
    };
    const pendingMsg: ChatMessage = {
      id: `pending-${Date.now()}`,
      role: "assistant",
      content: "",
      pending: true,
    };
    set({
      messages: [...get().messages, userMsg, pendingMsg],
      isStreaming: true,
      error: null,
    });

    try {
      const runId = await sendMessage({
        workspacePath: ws,
        conversationId: convoId,
        userText: text,
        ...(ai.id === "ollama"
          ? { baseUrl: ai.ollamaBaseUrl }
          : ai.id === "lmstudio"
            ? { baseUrl: ai.lmstudioBaseUrl }
            : {}),
        temperature: ai.temperature,
        chatMode: get().chatMode,
      });
      set({ runId });
    } catch (e) {
      set({
        isStreaming: false,
        runId: null,
        error: String((e as Error).message ?? e),
        messages: get().messages.filter((m) => !m.pending),
      });
    }
  },

  cancel: async () => {
    const id = get().runId;
    // Free the UI immediately so the user gets out of the streaming
    // state even if the backend Cancelled event takes a while (slow
    // Ollama models can keep generating on the server side after the
    // HTTP connection drops). The pending message is marked cancelled
    // here so it's not left dangling if the backend never replies.
    const msgs = get().messages.map((m) =>
      m.pending ? { ...m, pending: false, warning: "Cancelado" } : m,
    );
    set({ messages: msgs, isStreaming: false, runId: null });
    if (!id) return;
    try {
      await cancelRun(id);
    } catch {
      /* best-effort: backend may have already finished */
    }
  },

  attachListener: async () => {
    if (listenerRef) return listenerRef;
    listenerRef = listen<StreamPayload>(AGENT_STREAM_EVENT, (e) => {
      const payload = e.payload;
      const state = get();
      // Started can race ahead of sendMessage()'s resolved runId — adopt
      // it eagerly when the conversation matches so deltas aren't filtered.
      if (payload.type === "started") {
        if (payload.conversationId === state.activeConvoId) {
          set({ runId: payload.runId });
        }
        return;
      }
      if (state.runId && payload.runId !== state.runId) return;

      if (payload.type === "delta") {
        const msgs = state.messages.slice();
        const idx = msgs.findIndex((m) => m.pending);
        if (idx >= 0 && msgs[idx]) {
          msgs[idx] = {
            ...msgs[idx],
            content: msgs[idx].content + payload.text,
          };
          set({ messages: msgs });
        }
      } else if (payload.type === "replaceText") {
        // Backend stripped a tool-call JSON payload out of the streamed
        // text. Replace the pending message body wholesale.
        const msgs = state.messages.slice();
        const idx = msgs.findIndex((m) => m.pending);
        if (idx >= 0 && msgs[idx]) {
          msgs[idx] = { ...msgs[idx], content: payload.text };
          set({ messages: msgs });
        }
      } else if (payload.type === "warning") {
        const msgs = state.messages.slice();
        const idx = msgs.findIndex((m) => m.pending);
        if (idx >= 0 && msgs[idx]) {
          msgs[idx] = { ...msgs[idx], warning: payload.message };
          set({ messages: msgs });
        }
      } else if (payload.type === "toolUseStart") {
        const msgs = state.messages.slice();
        const idx = msgs.findIndex((m) => m.pending);
        if (idx >= 0 && msgs[idx]) {
          const existing = msgs[idx].toolCalls ?? [];
          const next: ToolBlock = {
            id: payload.id,
            name: payload.name,
            argsJson: "",
            status: "running",
            startedAt: Date.now(),
          };
          msgs[idx] = {
            ...msgs[idx],
            toolCalls: [...existing, next],
          };
          set({ messages: msgs });
        }
      } else if (payload.type === "toolUseArgsDelta") {
        const msgs = state.messages.slice();
        const idx = msgs.findIndex((m) => m.pending);
        if (idx >= 0 && msgs[idx]?.toolCalls) {
          const calls = msgs[idx].toolCalls!.map((c) =>
            c.id === payload.id
              ? { ...c, argsJson: c.argsJson + payload.fragment }
              : c,
          );
          msgs[idx] = { ...msgs[idx], toolCalls: calls };
          set({ messages: msgs });
        }
      } else if (payload.type === "toolUseDone") {
        const msgs = state.messages.slice();
        const idx = msgs.findIndex((m) => m.pending);
        if (idx >= 0 && msgs[idx]?.toolCalls) {
          const calls = msgs[idx].toolCalls!.map((c) =>
            c.id === payload.id
              ? { ...c, status: "done" as const, argsAt: Date.now() }
              : c,
          );
          msgs[idx] = { ...msgs[idx], toolCalls: calls };
          set({ messages: msgs });
        }
      } else if (payload.type === "toolResult") {
        // Tag the matching tool call with its result. Lookup walks back
        // because by the time the result arrives, the assistant turn may
        // have stopped pending (next iteration of the agent loop
        // started). Search every message's toolCalls.
        const msgs = state.messages.map((m) => {
          if (!m.toolCalls) return m;
          let changed = false;
          const next = m.toolCalls.map((c) => {
            if (c.id !== payload.id) return c;
            changed = true;
            return {
              ...c,
              status: "result" as const,
              result: { ok: payload.ok, output: payload.output },
              completedAt: Date.now(),
            };
          });
          return changed ? { ...m, toolCalls: next } : m;
        });
        set({ messages: msgs });
      } else if (payload.type === "done") {
        const msgs = state.messages.map((m) =>
          m.pending
            ? {
                ...m,
                pending: false,
                id: payload.messageId || m.id,
              }
            : m,
        );
        set({ messages: msgs, isStreaming: false, runId: null });
        void get().refreshConversations();
      } else if (payload.type === "cancelled") {
        const msgs = state.messages.map((m) =>
          m.pending ? { ...m, pending: false, warning: "Cancelado" } : m,
        );
        set({ messages: msgs, isStreaming: false, runId: null });
      } else if (payload.type === "error") {
        const msgs = state.messages.filter((m) => !m.pending);
        set({
          messages: msgs,
          isStreaming: false,
          runId: null,
          error: payload.message,
        });
      }
    });
    return listenerRef;
  },
}));
