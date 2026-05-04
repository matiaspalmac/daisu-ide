// Typed wrappers for the M3 Phase 3 inline-edit Tauri commands.
//
// The backend stores pending edit proposals in AppState keyed by a Uuid.
// `proposeEdit` reads the file, computes hunks via `similar`, and returns
// the proposal so the UI can render an Accept/Reject overlay.
// `applyEdit` writes the final content (original + only the accepted
// hunks). `rejectEdit` drops the proposal without touching disk.

import { invoke } from "@tauri-apps/api/core";

export interface EditHunk {
  startOld: number;
  endOld: number;
  startNew: number;
  endNew: number;
  oldLines: string[];
  newLines: string[];
}

export interface EditProposal {
  proposalId: string;
  path: string;
  hunks: EditHunk[];
}

export interface ApplyResult {
  path: string;
  bytes: number;
  lineCount: number;
}

export interface PendingEdit {
  proposalId: string;
  path: string;
  hunkCount: number;
}

export interface ProposeEditRequest {
  workspacePath?: string;
  path: string;
  newText: string;
}

export function proposeEdit(req: ProposeEditRequest): Promise<EditProposal> {
  return invoke<EditProposal>("agent_propose_edit", { req });
}

export function applyEdit(
  proposalId: string,
  acceptedHunkIndices: number[],
): Promise<ApplyResult> {
  return invoke<ApplyResult>("agent_apply_edit", {
    req: { proposalId, acceptedHunkIndices },
  });
}

export function rejectEdit(proposalId: string): Promise<void> {
  return invoke("agent_reject_edit", { req: { proposalId } });
}

export function listPendingEdits(): Promise<PendingEdit[]> {
  return invoke<PendingEdit[]>("agent_list_pending_edits");
}
