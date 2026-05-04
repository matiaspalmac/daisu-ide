import { create } from "zustand";
import {
  applyEdit,
  proposeEdit,
  rejectEdit,
  type EditProposal,
  type ProposeEditRequest,
} from "../lib/agent-edits";
import { useUI } from "./uiStore";

interface InlineEditState {
  proposals: Record<string, EditProposal>;
  activeProposalId: string | null;
  acceptedHunks: Set<number>;

  startProposal: (req: ProposeEditRequest) => Promise<EditProposal | null>;
  loadProposal: (id: string) => void;
  toggleHunk: (idx: number) => void;
  selectAll: () => void;
  selectNone: () => void;
  accept: () => Promise<void>;
  reject: () => Promise<void>;
  close: () => void;
}

export const useInlineEdits = create<InlineEditState>((set, get) => ({
  proposals: {},
  activeProposalId: null,
  acceptedHunks: new Set<number>(),

  startProposal: async (req) => {
    try {
      const proposal = await proposeEdit(req);
      set((s) => ({
        proposals: { ...s.proposals, [proposal.proposalId]: proposal },
        activeProposalId: proposal.proposalId,
        // Default to all hunks selected — matches the user expectation that
        // "Accept all" is the most common choice for a freshly proposed edit.
        acceptedHunks: new Set(proposal.hunks.map((_, i) => i)),
      }));
      return proposal;
    } catch (err) {
      useUI.getState().pushToast({
        message: `propose_edit failed: ${(err as Error).message ?? err}`,
        level: "error",
      });
      return null;
    }
  },

  loadProposal: (id) =>
    set((s) => {
      const proposal = s.proposals[id];
      if (!proposal) return s;
      return {
        activeProposalId: id,
        acceptedHunks: new Set(proposal.hunks.map((_, i) => i)),
      };
    }),

  toggleHunk: (idx) =>
    set((s) => {
      const next = new Set(s.acceptedHunks);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { acceptedHunks: next };
    }),

  selectAll: () =>
    set((s) => {
      const id = s.activeProposalId;
      const proposal = id ? s.proposals[id] : null;
      if (!proposal) return s;
      return { acceptedHunks: new Set(proposal.hunks.map((_, i) => i)) };
    }),

  selectNone: () => set({ acceptedHunks: new Set<number>() }),

  accept: async () => {
    const { activeProposalId, acceptedHunks, proposals } = get();
    if (!activeProposalId) return;
    try {
      const result = await applyEdit(
        activeProposalId,
        Array.from(acceptedHunks).sort((a, b) => a - b),
      );
      useUI.getState().pushToast({
        message: `Edit applied: ${result.path} (${result.lineCount} lines)`,
        level: "success",
      });
      const next = { ...proposals };
      delete next[activeProposalId];
      set({
        proposals: next,
        activeProposalId: null,
        acceptedHunks: new Set<number>(),
      });
    } catch (err) {
      useUI.getState().pushToast({
        message: `apply_edit failed: ${(err as Error).message ?? err}`,
        level: "error",
      });
    }
  },

  reject: async () => {
    const { activeProposalId, proposals } = get();
    if (!activeProposalId) return;
    try {
      await rejectEdit(activeProposalId);
    } catch {
      // best-effort: even if backend forgot the id, still drop locally
    }
    const next = { ...proposals };
    delete next[activeProposalId];
    set({
      proposals: next,
      activeProposalId: null,
      acceptedHunks: new Set<number>(),
    });
  },

  close: () =>
    set({ activeProposalId: null, acceptedHunks: new Set<number>() }),
}));
