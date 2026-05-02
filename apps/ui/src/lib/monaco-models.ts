import type * as monaco from "monaco-editor";
import { useTabs } from "../stores/tabsStore";
import type { OpenTab } from "../stores/tabsStore";

/// Monaco namespace passed in from `@monaco-editor/react`'s `onMount`. We do
/// NOT statically import `monaco-editor` here because the package's barrel
/// pulls every built-in language mode (~1 MB gzipped) into the main chunk.
type MonacoNamespace = typeof monaco;

const models = new Map<string, monaco.editor.ITextModel>();

export function getOrCreateModel(
  m: MonacoNamespace,
  tab: OpenTab,
): monaco.editor.ITextModel {
  const existing = models.get(tab.id);
  if (existing) return existing;

  const uri = m.Uri.parse(`daisu://tab/${tab.id}`);
  const model = m.editor.createModel(tab.content, tab.language, uri);
  model.onDidChangeContent(() => {
    useTabs.getState().updateContent(tab.id, model.getValue());
  });
  models.set(tab.id, model);
  return model;
}

export function hasModel(tabId: string): boolean {
  return models.has(tabId);
}

export function disposeModel(tabId: string): void {
  const m = models.get(tabId);
  if (m) {
    m.dispose();
    models.delete(tabId);
  }
}

export function disposeAllModels(): void {
  for (const m of models.values()) m.dispose();
  models.clear();
}
