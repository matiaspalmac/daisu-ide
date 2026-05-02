// Tiny abstraction around tauri-plugin-store for the workspace persistence blob.
// Frontend tests mock this module; production code uses the real plugin.

import { Store } from "@tauri-apps/plugin-store";

export interface WorkspacePersistence {
  recents: { path: string; name: string; openedAt: number }[];
  expandedPersisted: Record<string, string[]>;
}

const STORE_KEY = "workspace.json";
const ROOT_KEY = "workspace";

let cachedStore: Store | null = null;

async function getStore(): Promise<Store> {
  if (!cachedStore) {
    cachedStore = await Store.load(STORE_KEY);
  }
  return cachedStore;
}

export async function loadWorkspacePersistence(): Promise<WorkspacePersistence> {
  try {
    const store = await getStore();
    const value = await store.get<WorkspacePersistence>(ROOT_KEY);
    if (!value) return { recents: [], expandedPersisted: {} };
    return value;
  } catch {
    return { recents: [], expandedPersisted: {} };
  }
}

export async function saveWorkspacePersistence(
  data: WorkspacePersistence
): Promise<void> {
  try {
    const store = await getStore();
    await store.set(ROOT_KEY, data);
    await store.save();
  } catch {
    // Persistence is best-effort; component code keeps working without it.
  }
}
