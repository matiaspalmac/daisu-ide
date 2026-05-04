import { create } from "zustand";
import type { PermissionRequestPayload } from "../lib/agent-tools";

interface PermissionState {
  queue: PermissionRequestPayload[];
  current: PermissionRequestPayload | null;

  enqueue: (req: PermissionRequestPayload) => void;
  /** Pop the head of the queue and promote it to `current`. */
  advance: () => void;
  /** Clear `current` (after a decision was sent to the backend). */
  clearCurrent: () => void;
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  queue: [],
  current: null,

  enqueue: (req) => {
    const state = get();
    if (state.current) {
      set({ queue: [...state.queue, req] });
    } else {
      set({ current: req });
    }
  },

  advance: () => {
    const state = get();
    if (state.current) return;
    const [head, ...rest] = state.queue;
    if (head) set({ current: head, queue: rest });
  },

  clearCurrent: () => {
    const state = get();
    const [head, ...rest] = state.queue;
    set({ current: head ?? null, queue: rest });
  },
}));
