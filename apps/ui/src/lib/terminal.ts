import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface TermSpawnOpts {
  cwd: string;
  shell?: string | null;
  cols: number;
  rows: number;
}

export async function terminalSpawn(opts: TermSpawnOpts): Promise<string> {
  const { id } = await invoke<{ id: string }>("terminal_spawn", { req: opts });
  return id;
}

export function terminalWrite(id: string, data: string): Promise<void> {
  const bytes = new TextEncoder().encode(data);
  let b = "";
  for (const x of bytes) b += String.fromCharCode(x);
  const payload = btoa(b);
  return invoke<void>("terminal_write", { req: { id, data: payload } });
}

export function terminalResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke<void>("terminal_resize", { req: { id, cols, rows } });
}

export function terminalKill(id: string): Promise<void> {
  return invoke<void>("terminal_kill", { req: { id } });
}

export function terminalList(): Promise<string[]> {
  return invoke<string[]>("terminal_list");
}

export async function onTerminalOutput(
  id: string,
  cb: (chunk: Uint8Array) => void,
): Promise<UnlistenFn> {
  return listen<string>(`terminal://output:${id}`, (ev) => {
    const bin = atob(ev.payload);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    cb(out);
  });
}

export async function onTerminalExit(id: string, cb: () => void): Promise<UnlistenFn> {
  return listen<null>(`terminal://exit:${id}`, () => cb());
}
