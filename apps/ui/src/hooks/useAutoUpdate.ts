import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUI } from "../stores/uiStore";
import { isTauri } from "../lib/tauri-env";

const STARTUP_DELAY_MS = 5_000;
const RECHECK_INTERVAL_MS = 60 * 60 * 1_000;

let alreadyChecking = false;

/**
 * Background update checker. Polls the GitHub release manifest five
 * seconds after boot (so the first paint completes uninterrupted) and
 * every hour after that. When a newer signed build is available the
 * user gets a toast with an "Update" action that downloads + installs
 * + relaunches the app via `tauri-plugin-process`.
 *
 * Keeps state in a module-level guard so React StrictMode double-invoke
 * does not start two parallel checks.
 */
export function useAutoUpdate(): void {
  const { t } = useTranslation();
  const pushToast = useUI((s) => s.pushToast);
  const dismissToast = useUI((s) => s.dismissToast);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let timeout: number | null = null;
    let interval: number | null = null;

    const offerUpdate = (update: Update): void => {
      if (cancelled) return;
      const toastId = pushToast({
        message: t("update.available", { version: update.version }),
        level: "info",
        durationMs: 30_000,
        action: {
          label: t("update.installButton"),
          onAction: async () => {
            dismissToast(toastId);
            const installingId = pushToast({
              message: t("update.downloading"),
              level: "info",
              durationMs: 60_000,
            });
            try {
              await update.downloadAndInstall();
              dismissToast(installingId);
              pushToast({
                message: t("update.installedRelaunching"),
                level: "success",
                durationMs: 5_000,
              });
              await relaunch();
            } catch (e) {
              dismissToast(installingId);
              pushToast({
                message: t("update.failed", {
                  error: String((e as Error).message ?? e),
                }),
                level: "error",
                durationMs: 10_000,
              });
            }
          },
        },
      });
    };

    const runCheck = async (): Promise<void> => {
      if (alreadyChecking) return;
      alreadyChecking = true;
      try {
        const update = await check();
        if (!cancelled && update !== null) {
          offerUpdate(update);
        }
      } catch {
        // Network offline, GitHub rate-limited, manifest 404 (no release
        // yet) — silent. The hourly recheck will retry; the user can
        // still download manually from the releases page.
      } finally {
        alreadyChecking = false;
      }
    };

    timeout = window.setTimeout(() => void runCheck(), STARTUP_DELAY_MS);
    interval = window.setInterval(() => void runCheck(), RECHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timeout !== null) window.clearTimeout(timeout);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [t, pushToast, dismissToast]);
}
