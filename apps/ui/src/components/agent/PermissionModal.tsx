import { useEffect, type JSX } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ShieldWarning, X } from "@phosphor-icons/react";
import { usePermissionStore } from "../../stores/permissionStore";
import { useWorkspace } from "../../stores/workspaceStore";
import {
  listenForPermissionRequests,
  resolvePermission,
  type Decision,
} from "../../lib/agent-tools";
import { isTauri } from "../../lib/tauri-env";

/**
 * Mount once at the app root. No UI — only wires the Rust gate's
 * `agent://permission-request` event into the permission store. The
 * actual prompt is rendered inline inside the agent panel via
 * {@link PermissionInline}, anchored above the composer instead of
 * blocking the whole IDE with a modal.
 */
export function PermissionModal(): JSX.Element | null {
  const enqueue = usePermissionStore((s) => s.enqueue);

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

  return null;
}

/**
 * Inline permission prompt rendered above the chat composer when the
 * agent is asking to run a tool. Replaces the global modal so the
 * request lives next to the conversation it relates to and the user
 * can keep reading the chat while deciding.
 */
export function PermissionInline(): JSX.Element | null {
  const { t } = useTranslation();
  const current = usePermissionStore((s) => s.current);
  const clearCurrent = usePermissionStore((s) => s.clearCurrent);
  const workspacePath = useWorkspace((s) => s.rootPath);

  if (!current) return null;

  async function decide(decision: Decision): Promise<void> {
    if (!current || !workspacePath) {
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
    <div
      className="daisu-permission-inline"
      role="alertdialog"
      aria-labelledby="permission-inline-title"
    >
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
          onClick={() => void decide("deny")}
          title={t("permissionModal.denyEditTooltip")}
        >
          {t("permissionModal.denyEdit")}
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
    </div>
  );
}
