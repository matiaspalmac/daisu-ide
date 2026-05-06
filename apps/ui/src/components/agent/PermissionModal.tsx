import { useEffect, type JSX } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ShieldWarning, X } from "@phosphor-icons/react";
import { usePermissionStore } from "../../stores/permissionStore";
import { useWorkspace } from "../../stores/workspaceStore";
import {
  listenForPermissionRequests,
  resolvePermission,
  type Decision,
  type PermissionRequestPayload,
} from "../../lib/agent-tools";
import { isTauri } from "../../lib/tauri-env";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

/**
 * Mount once at the app root. Wires the Rust gate's
 * `agent://permission-request` event into the permission store and renders
 * a fallback Dialog whenever the inline prompt (chat panel) is not
 * mounted — without it, hiding the chat panel, switching to config mode,
 * or entering focus mode would silently stall any pending tool call.
 */
export function PermissionModal(): JSX.Element | null {
  const enqueue = usePermissionStore((s) => s.enqueue);
  const current = usePermissionStore((s) => s.current);
  const inlineMounted = usePermissionStore((s) => s.inlineMounted);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    void listenForPermissionRequests((payload) => enqueue(payload)).then(
      (fn) => {
        unlisten = fn;
      },
    );
    return () => {
      if (unlisten) unlisten();
    };
  }, [enqueue]);

  // The inline prompt (rendered above the chat composer) is preferred
  // when the chat panel is visible — keeps the request next to the
  // conversation it relates to. Otherwise fall back to a centered Dialog
  // so requests never stall.
  const showFallback = !!current && !inlineMounted;

  return (
    <Dialog open={showFallback}>
      <DialogContent
        className="max-w-md p-0"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="items-start">
          <DialogTitle className="flex items-center gap-2">
            <ShieldWarning
              size={14}
              weight="fill"
              className="text-[var(--accent)]"
            />
            <span>
              {current
                ? // Translation handled by inner body so we don't double-render.
                  current.tool_name
                : ""}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Agent tool permission request
          </DialogDescription>
        </DialogHeader>
        {current && (
          <div className="p-4 pt-2">
            <PermissionBody current={current} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline permission prompt rendered above the chat composer when the
 * chat panel is visible. Registers itself with the permission store so
 * the fallback Dialog stays out of the way while it owns the prompt.
 */
export function PermissionInline(): JSX.Element | null {
  const current = usePermissionStore((s) => s.current);
  const setInlineMounted = usePermissionStore((s) => s.setInlineMounted);

  useEffect(() => {
    setInlineMounted(true);
    return () => setInlineMounted(false);
  }, [setInlineMounted]);

  if (!current) return null;

  return (
    <div
      className="daisu-permission-inline"
      role="alertdialog"
      aria-labelledby="permission-inline-title"
    >
      <PermissionBody current={current} variant="inline" />
    </div>
  );
}

interface PermissionBodyProps {
  current: PermissionRequestPayload;
  variant?: "inline" | "modal";
}

function PermissionBody({
  current,
  variant = "modal",
}: PermissionBodyProps): JSX.Element {
  const { t } = useTranslation();
  const clearCurrent = usePermissionStore((s) => s.clearCurrent);
  const workspacePath = useWorkspace((s) => s.rootPath);

  async function decide(decision: Decision): Promise<void> {
    if (!workspacePath) {
      clearCurrent();
      return;
    }
    try {
      await resolvePermission({
        workspacePath,
        requestId: current.request_id,
        decision,
      });
    } finally {
      clearCurrent();
    }
  }

  return (
    <>
      {variant === "inline" && (
        <div className="daisu-permission-inline-head">
          <ShieldWarning
            size={14}
            weight="fill"
            className="text-[var(--accent)]"
          />
          <span
            id="permission-inline-title"
            className="daisu-permission-inline-title"
          >
            {t("permissionModal.title", { tool: current.tool_name })}
          </span>
          <button
            type="button"
            className="daisu-permission-inline-close"
            onClick={() => void decide("deny")}
            aria-label={t("permissionModal.deny")}
          >
            <X size={12} />
          </button>
        </div>
      )}
      {variant === "modal" && (
        <p className="daisu-permission-inline-title mb-2">
          {t("permissionModal.title", { tool: current.tool_name })}
        </p>
      )}
      <p className="daisu-permission-inline-desc">
        <Trans
          i18nKey="permissionModal.description"
          values={{
            tool: current.tool_name,
            tier: current.tier,
            scope: current.scope,
          }}
          components={[<code key="0" />, <code key="1" />]}
        />
      </p>
      <p className="daisu-permission-inline-summary font-mono">
        {current.summary}
      </p>
      <div className="daisu-permission-inline-actions">
        <button
          type="button"
          className="daisu-btn"
          onClick={() => void decide("deny")}
        >
          {t("permissionModal.deny")}
        </button>
        <button
          type="button"
          className="daisu-btn"
          onClick={() => void decide("allowonce")}
        >
          {t("permissionModal.allowOnce")}
        </button>
        <button
          type="button"
          className="daisu-btn daisu-btn-primary"
          onClick={() => void decide("allowalways")}
        >
          {t("permissionModal.allowAlways")}
        </button>
      </div>
    </>
  );
}
