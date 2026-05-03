import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import * as Popover from "@radix-ui/react-popover";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Check } from "@phosphor-icons/react";
import { useGit } from "../../stores/gitStore";
import { useUI } from "../../stores/uiStore";
import type { BranchInfo } from "../../api/tauri";
import { translateError } from "../../lib/error-translate";

interface Props {
  trigger: ReactNode;
}

export function BranchPicker(props: Props): JSX.Element {
  const branches = useGit((s) => s.branches);
  const loadBranches = useGit((s) => s.loadBranches);
  const checkoutBranch = useGit((s) => s.checkoutBranch);
  const hasDirtyTree = useGit((s) => s.hasDirtyTree);
  const pushToast = useUI((s) => s.pushToast);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [pendingDirty, setPendingDirty] = useState<BranchInfo | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    void loadBranches();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, loadBranches]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, filter]);

  const tryCheckout = async (b: BranchInfo): Promise<void> => {
    if (b.isHead) {
      setOpen(false);
      return;
    }
    if (hasDirtyTree()) {
      setPendingDirty(b);
      return;
    }
    try {
      await checkoutBranch(b.name, false);
      pushToast({ message: `Switched to ${b.name}`, level: "success" });
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    } finally {
      setOpen(false);
    }
  };

  const forceCheckout = async (): Promise<void> => {
    if (!pendingDirty) return;
    const b = pendingDirty;
    setPendingDirty(null);
    try {
      await checkoutBranch(b.name, true);
      pushToast({ message: `Force-switched to ${b.name}`, level: "success" });
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    } finally {
      setOpen(false);
    }
  };

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>{props.trigger}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="daisu-language-popover"
            sideOffset={6}
            align="start"
          >
            <input
              ref={inputRef}
              type="text"
              className="daisu-language-filter"
              placeholder="Filter branches..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="daisu-language-list">
              {filtered.map((b) => (
                <button
                  key={`${b.isRemote ? "r" : "l"}/${b.name}`}
                  type="button"
                  className={`daisu-language-item${b.isHead ? " is-active" : ""}`}
                  onClick={() => void tryCheckout(b)}
                >
                  {b.isHead && <Check size={12} />}
                  {b.isRemote ? `↗ ${b.name}` : b.name}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="daisu-language-empty">No branches</div>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <AlertDialog.Root
        open={pendingDirty !== null}
        onOpenChange={(o) => !o && setPendingDirty(null)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="daisu-modal-overlay" />
          <AlertDialog.Content
            className="daisu-modal"
            aria-describedby={undefined}
          >
            <AlertDialog.Title className="daisu-modal-title">
              Switch to {pendingDirty?.name}?
            </AlertDialog.Title>
            <AlertDialog.Description className="daisu-modal-body">
              The working tree has uncommitted changes. Force checkout will
              discard them. This cannot be undone.
            </AlertDialog.Description>
            <div className="daisu-modal-actions">
              <button
                type="button"
                className="daisu-btn"
                onClick={() => setPendingDirty(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="daisu-btn-primary"
                onClick={() => void forceCheckout()}
              >
                Force checkout
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
