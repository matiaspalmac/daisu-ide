import type { Monaco } from "@monaco-editor/react";

export interface LanguageEntry {
  id: string;
  aliases: string[];
}

let cache: LanguageEntry[] | null = null;

/** Read monaco's built-in language list and cache the snapshot. */
export function loadLanguageList(monaco: Monaco): LanguageEntry[] {
  if (cache) return cache;
  const languages = monaco.languages.getLanguages();
  cache = languages.map((l) => ({
    id: l.id,
    aliases: (l as unknown as { aliases?: string[] }).aliases ?? [l.id],
  }));
  return cache;
}

export function clearLanguageListCache(): void {
  cache = null;
}
