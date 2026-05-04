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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  pending?: boolean;
  warning?: string;
}

interface AgentState {
  conversations: ConversationSummary[];
  activeConvoId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  runId: string | null;
  error: string | null;
  workspacePath: string | null;

  setWorkspace: (path: string | null) => Promise<void>;
  refreshConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: (title?: string) => Promise<string | null>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  attachListener: () => Promise<UnlistenFn>;
}

let listenerRef: Promise<UnlistenFn> | null = null;

export const useAgent = create<AgentState>((set, get) => ({
  conversations: [],
  activeConvoId: null,
  messages: [],
  isStreaming: false,
  runId: null,
  error: null,
  workspacePath: null,

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
        title ?? "Nueva conversación",
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
    if (!id) return;
    await cancelRun(id);
  },

  attachListener: async () => {
    if (listenerRef) return listenerRef;
    listenerRef = listen<StreamPayload>(AGENT_STREAM_EVENT, (e) => {
      const payload = e.payload;
      const state = get();
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
      } else if (payload.type === "warning") {
        const msgs = state.messages.slice();
        const idx = msgs.findIndex((m) => m.pending);
        if (idx >= 0 && msgs[idx]) {
          msgs[idx] = { ...msgs[idx], warning: payload.message };
          set({ messages: msgs });
        }
      } else if (payload.type === "done") {
        const msgs = state.messages.map((m) =>
          m.pending ? { ...m, pending: false, id: payload.messageId } : m,
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
