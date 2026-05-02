import * as monaco from "monaco-editor";
import { useTabs } from "../stores/tabsStore";
import type { OpenTab } from "../stores/tabsStore";

const models = new Map<string, monaco.editor.ITextModel>();

export function getOrCreateModel(tab: OpenTab): monaco.editor.ITextModel {
  const existing = models.get(tab.id);
  if (existing) return existing;

  const uri = monaco.Uri.parse(`daisu://tab/${tab.id}`);
  const model = monaco.editor.createModel(tab.content, tab.language, uri);
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
