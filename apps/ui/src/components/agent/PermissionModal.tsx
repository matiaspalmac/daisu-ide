import { useEffect, type JSX } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { usePermissionStore } from "../../stores/permissionStore";
import { useWorkspace } from "../../stores/workspaceStore";
import {
  listenForPermissionRequests,
  resolvePermission,
  type Decision,
} from "../../lib/agent-tools";
import { isTauri } from "../../lib/tauri-env";

/**
 * Mounted once in `App.tsx`. Listens for `agent://permission-request`
 * events from the Rust gate, queues them in `permissionStore`, and
 * renders one Radix dialog per pending request.
 *
 * "Deny + edit prompt" is a placeholder for M3 phase 3 — for the
 * scaffold it just denies and closes. Phase 3 will route the
 * rejected prompt back to the chat composer.
 */
export function PermissionModal(): JSX.Element | null {
  const current = usePermissionStore((s) => s.current);
  const enqueue = usePermissionStore((s) => s.enqueue);
  const clearCurrent = usePermissionStore((s) => s.clearCurrent);
  const workspacePath = useWorkspace((s) => s.rootPath);

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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void decide("deny");
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Permiso requerido · {current.tool_name}
          </DialogTitle>
          <DialogDescription>
            El agente quiere ejecutar la herramienta{" "}
            <code>{current.tool_name}</code> ({current.tier}) en el alcance{" "}
            <code>{current.scope}</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 py-3 text-xs text-[var(--fg-secondary)]">
          <p className="mb-1 font-mono break-all">{current.summary}</p>
        </div>
        <DialogFooter>
          <button
            type="button"
            className="daisu-btn"
            onClick={() => void decide("deny")}
          >
            Denegar
          </button>
          <button
            type="button"
            className="daisu-btn"
            onClick={() => void decide("denyalways")}
          >
            Denegar y editar
          </button>
          <button
            type="button"
            className="daisu-btn"
            onClick={() => void decide("allowonce")}
          >
            Permitir una vez
          </button>
          <button
            type="button"
            className="daisu-btn daisu-btn-primary"
            onClick={() => void decide("allowalways")}
          >
            Permitir siempre
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
