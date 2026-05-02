import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

export interface OpenedFile {
  path: string;
  contents: string;
  language: string;
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
