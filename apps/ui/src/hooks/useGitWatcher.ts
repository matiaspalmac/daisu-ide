import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useGit } from "../stores/gitStore";

/**
 * Subscribe to `git-changed` Tauri events and window focus events; both
 * trigger `gitStore.refresh()`. Watcher is spawned by the backend's
 * `open_workspace` command — frontend only listens.
 */
export function useGitWatcher(): void {
  useEffect(() => {
    let cancelled = false;
    let unlistenGit: (() => void) | null = null;
    let unlistenFocus: (() => void) | null = null;

    void listen<unknown>("git-changed", () => {
      if (cancelled) return;
      void useGit.getState().refresh();
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlistenGit = fn;
    });

    void listen<unknown>("tauri://focus", () => {
      if (cancelled) return;
      void useGit.getState().refresh();
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlistenFocus = fn;
    });

    return () => {
      cancelled = true;
      if (unlistenGit) unlistenGit();
      if (unlistenFocus) unlistenFocus();
    };
  }, []);
}
