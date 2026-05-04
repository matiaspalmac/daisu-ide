// Slash-command stubs for the M3 Phase 3 palette scaffold.
//
// TODO(Phase 1 merge): once `agent_send_message` + the chat conversation
// store land, replace the toast pushes below with a real `sendMessage()`
// call into the active conversation, prefilled with the slash prompt + any
// available editor selection / diagnostics. The four canonical commands
// are: /explain, /fix, /test, /refactor. Wiring is intentionally minimal
// here so this branch compiles against `main` without depending on Phase 1.

import { useUI } from "../stores/uiStore";

export type SlashCommand = "explain" | "fix" | "test" | "refactor";

export interface SlashContext {
  selection?: string;
  filePath?: string;
}

export const SLASH_PROMPTS: Record<SlashCommand, string> = {
  explain: "Explain the current selection",
  fix: "Fix this code",
  test: "Generate a test for this selection",
  refactor: "Refactor this selection",
};

export function runSlashCommand(name: SlashCommand, _ctx: SlashContext = {}): void {
  const prompt = SLASH_PROMPTS[name];
  // TODO(Phase 1): replace with sendMessage(activeConversationId, prompt + ctx).
  // For /fix specifically we'll need a diagnostics provider — Phase 4 adds
  // the LSP bridge; until then we hardcode the placeholder in the toast.
  const note =
    name === "fix" ? " (no diagnostics provider yet)" : "";
  useUI.getState().pushToast({
    message: `/${name}: ${prompt}${note}`,
    level: "info",
  });
}

export function agentSlashCommand(name: SlashCommand): void {
  runSlashCommand(name);
}
