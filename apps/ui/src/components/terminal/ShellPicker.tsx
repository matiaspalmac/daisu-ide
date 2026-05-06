import { useEffect, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown, Plus, Star } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useShells } from "../../stores/shellsStore";
import type { DetectedShell } from "../../lib/terminal";

interface Props {
  onPick: (shell: DetectedShell | null) => void;
}

export function ShellPicker({ onPick }: Props): JSX.Element {
  const { t } = useTranslation();
  const shells = useShells((s) => s.shells);
  const ensureLoaded = useShells((s) => s.ensureLoaded);
  const rescan = useShells((s) => s.rescan);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  return (
    <div className="flex items-center">
      <button
        type="button"
        className="px-2 h-6 text-[11px] flex items-center gap-1 text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--bg-elevated)]"
        onClick={() => onPick(null)}
        title={t("terminal.shells.newDefault")}
      >
        <Plus size={11} />
        <span>{t("terminal.newTab")}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="px-1 h-6 flex items-center text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--bg-elevated)]"
            title={t("terminal.shells.pick")}
            aria-label={t("terminal.shells.pick")}
          >
            <CaretDown size={10} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          {shells.length === 0 ? (
            <DropdownMenuItem disabled>{t("terminal.shells.empty")}</DropdownMenuItem>
          ) : (
            shells.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onSelect={() => onPick(s)}
                className="text-[12px]"
              >
                <span className="flex-1 truncate">{s.label}</span>
                {s.isDefault && (
                  <Star size={10} className="ml-2 text-[var(--accent)]" />
                )}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void rescan()} className="text-[11px] text-[var(--fg-muted)]">
            {t("terminal.shells.rescan")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
