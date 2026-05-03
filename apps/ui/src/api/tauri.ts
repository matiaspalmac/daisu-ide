import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

export interface OpenedFile {
  path: string;
  contents: string;
  language: string;
  eol: "LF" | "CRLF";
  encoding: string;
}

export async function openFileViaDialog(): Promise<OpenedFile | null> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    title: "Open file in Daisu",
  });
  if (selected === null || Array.isArray(selected)) {
    return null;
  }
  return invoke<OpenedFile>("open_file", { path: selected });
}

export async function saveFile(path: string, contents: string): Promise<void> {
  await invoke<void>("save_file", { path, contents });
}

export async function saveFileAsViaDialog(contents: string): Promise<string | null> {
  const target = await saveDialog({ title: "Save file as…" });
  if (target === null) {
    return null;
  }
  await saveFile(target, contents);
  return target;
}

export interface WebView2Status {
  installed: boolean;
  version: string | null;
}

export async function detectWebView2(): Promise<WebView2Status> {
  return invoke<WebView2Status>("detect_webview2");
}

export type FileKind = "file" | "dir";

export interface FileEntry {
  path: string;
  name: string;
  kind: FileKind;
  size: number | null;
  mtimeMs: number | null;
}

export interface WorkspaceInfo {
  root_path: string;
  batch_id: string;
}

export interface TrashRef {
  original_path: string;
}

export async function openWorkspaceCmd(path: string): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("open_workspace", { path });
}

export async function closeWorkspaceCmd(): Promise<void> {
  await invoke<void>("close_workspace");
}

export async function listDirCmd(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_dir", { path });
}

export async function createFileCmd(parent: string, name: string): Promise<string> {
  return invoke<string>("create_file", { parent, name });
}

export async function createDirCmd(parent: string, name: string): Promise<string> {
  return invoke<string>("create_dir", { parent, name });
}

export async function renamePathCmd(from: string, toName: string): Promise<string> {
  return invoke<string>("rename_path", { from, toName });
}

export async function deleteToTrashCmd(paths: string[]): Promise<TrashRef[]> {
  return invoke<TrashRef[]>("delete_to_trash", { paths });
}

export async function restoreFromTrashCmd(refs: TrashRef[]): Promise<void> {
  await invoke<void>("restore_from_trash", { refs });
}

export async function copyPathCmd(from: string, toParent: string): Promise<string> {
  return invoke<string>("copy_path", { from, toParent });
}

export async function openFile(path: string): Promise<OpenedFile> {
  return invoke<OpenedFile>("open_file", { path });
}

export async function saveSessionCmd(
  workspaceHash: string,
  blob: unknown,
): Promise<void> {
  await invoke<void>("save_session", { workspaceHash, blob });
}

export async function loadSessionCmd(
  workspaceHash: string,
): Promise<unknown | null> {
  return invoke<unknown | null>("load_session", { workspaceHash });
}

export async function deleteSessionCmd(workspaceHash: string): Promise<void> {
  await invoke<void>("delete_session", { workspaceHash });
}

export interface ThemeDescriptor {
  id: string;
  name: string;
  kind: "dark" | "light";
}

export async function listBundledThemesCmd(): Promise<ThemeDescriptor[]> {
  return invoke<ThemeDescriptor[]>("list_bundled_themes");
}

export async function readThemeJsonCmd(id: string): Promise<unknown> {
  return invoke<unknown>("read_theme_json", { id });
}

export async function exportSettingsCmd(targetPath: string): Promise<void> {
  await invoke<void>("export_settings", { targetPath });
}

export async function importSettingsCmd(sourcePath: string): Promise<unknown> {
  return invoke<unknown>("import_settings", { sourcePath });
}

// ---- Search ----

export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
  multiline: boolean;
  includeGlobs: string[];
  excludeGlobs: string[];
  maxResults: number;
}

export interface SearchHit {
  id: string;
  path: string;
  lineNo: number;
  lineText: string;
  matchStartCol: number;
  matchEndCol: number;
}

export interface SearchSummary {
  requestId: string;
  totalHits: number;
  filesSearched: number;
  truncated: boolean;
}

export interface SearchHitEvent {
  requestId: string;
  hits: SearchHit[];
}

export interface SearchProgressEvent {
  requestId: string;
  filesSearched: number;
}

export interface ReplaceRequest {
  options: SearchOptions;
  replacement: string;
  hits: SearchHit[];
  excludedHitIds: string[];
}

export interface ReplaceError {
  path: string;
  reason: string;
}

export interface ReplaceResults {
  filesModified: number;
  totalReplacements: number;
  errors: ReplaceError[];
}

function toBackendOptions(opts: SearchOptions): Record<string, unknown> {
  return {
    query: opts.query,
    case_sensitive: opts.caseSensitive,
    regex: opts.regex,
    whole_word: opts.wholeWord,
    multiline: opts.multiline,
    include_globs: opts.includeGlobs,
    exclude_globs: opts.excludeGlobs,
    max_results: opts.maxResults,
  };
}

export async function searchWorkspaceCmd(
  workspacePath: string,
  options: SearchOptions,
  requestId: string,
): Promise<SearchSummary> {
  return invoke<SearchSummary>("search_workspace", {
    workspacePath,
    options: toBackendOptions(options),
    requestId,
  });
}

export async function cancelSearchCmd(requestId: string): Promise<void> {
  await invoke<void>("cancel_search", { requestId });
}

export async function replaceInWorkspaceCmd(
  request: ReplaceRequest,
): Promise<ReplaceResults> {
  return invoke<ReplaceResults>("replace_in_workspace", {
    request: {
      options: toBackendOptions(request.options),
      replacement: request.replacement,
      hits: request.hits.map((h) => ({
        id: h.id,
        path: h.path,
        line_no: h.lineNo,
        line_text: h.lineText,
        match_start_col: h.matchStartCol,
        match_end_col: h.matchEndCol,
      })),
      excluded_hit_ids: request.excludedHitIds,
    },
  });
}

// ---- Git ----

export type GitFileStatus = "Modified" | "Untracked" | "Conflict" | "Staged";

export interface GitWorkspaceInfo {
  branch: string;
  ahead: number;
  behind: number;
  remoteUrl: string | null;
  statuses: Record<string, GitFileStatus>;
}

export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isHead: boolean;
}

export interface FetchResult {
  commitsReceived: number;
  remote: string;
}

export async function gitWorkspaceInfoCmd(
  workspacePath: string,
): Promise<GitWorkspaceInfo> {
  return invoke<GitWorkspaceInfo>("git_workspace_info", { workspacePath });
}

export async function gitListBranchesCmd(
  workspacePath: string,
): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>("git_list_branches", { workspacePath });
}

export async function gitCheckoutBranchCmd(
  workspacePath: string,
  branch: string,
  force: boolean,
): Promise<void> {
  await invoke<void>("git_checkout_branch", { workspacePath, branch, force });
}

export async function gitFetchRemoteCmd(
  workspacePath: string,
  remote: string,
): Promise<FetchResult> {
  return invoke<FetchResult>("git_fetch_remote", { workspacePath, remote });
}

// ---- File ops Phase 5 extensions ----

export async function convertEolCmd(
  path: string,
  target: "LF" | "CRLF",
): Promise<void> {
  await invoke<void>("convert_eol", { path, target });
}

export async function readFileWithEncodingCmd(
  path: string,
  encoding: string,
): Promise<OpenedFile> {
  return invoke<OpenedFile>("read_file_with_encoding", { path, encoding });
}

// === Discord Rich Presence ===

export interface DiscordActivityPayload {
  details?: string;
  state?: string;
  startTimestamp?: number;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
}

export async function discordConnectCmd(appId: string): Promise<void> {
  await invoke<void>("discord_connect", { appId });
}

export async function discordSetActivityCmd(
  payload: DiscordActivityPayload,
): Promise<void> {
  await invoke<void>("discord_set_activity", { payload });
}

export async function discordClearActivityCmd(): Promise<void> {
  await invoke<void>("discord_clear_activity");
}

export async function discordDisconnectCmd(): Promise<void> {
  await invoke<void>("discord_disconnect");
}
