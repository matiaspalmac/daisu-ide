import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useGit } from "../stores/gitStore";
import { isTauri } from "../lib/tauri-env";

/**
 * Subscribe to `git-changed` Tauri events and window focus events; both
 * trigger `gitStore.refresh()`. Watcher is spawned by the backend's
 * `open_workspace` command — frontend only listens.
 */
export function useGitWatcher(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlistenGit: (() => void) | null = null;
    let unlistenFocus: (() => void) | null = null;
    let timer: number | null = null;

    const refreshDebounced = (): void => {
      if (cancelled) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void useGit.getState().refresh();
      }, 250);
    };

    void listen<unknown>("git-changed", refreshDebounced).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlistenGit = fn;
    });

    void listen<unknown>("tauri://focus", refreshDebounced).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlistenFocus = fn;
    });

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (unlistenGit) unlistenGit();
      if (unlistenFocus) unlistenFocus();
    };
  }, []);
}
