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
