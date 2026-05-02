import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

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
