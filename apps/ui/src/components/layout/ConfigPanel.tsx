import type { JSX } from "react";
import { CaretLeft, Gear } from "@phosphor-icons/react";
import { useUI } from "../../stores/uiStore";
import { useSettings } from "../../stores/settingsStore";

export function ConfigPanel(): JSX.Element {
  const setRightPanelMode = useUI((s) => s.setRightPanelMode);
  const openSettings = useUI((s) => s.openSettings);
  const ai = useSettings((s) => s.settings.aiProvider);

  return (
    <aside
      className="h-full flex flex-col bg-[var(--bg-panel)] border-l border-[var(--border-subtle)]"
      aria-label="AI provider configuration"
    >
      <header className="h-9 px-3 flex items-center justify-between border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-[0.08em] text-[var(--fg-secondary)]">
        <span>Configuración</span>
        <button
          type="button"
          aria-label="Volver al chat"
          title="Volver al chat"
          onClick={() => setRightPanelMode("chat")}
          className="w-6 h-6 grid place-items-center text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] rounded-[var(--radius-sm)]"
        >
          <CaretLeft size={14} />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">
            Proveedor activo
          </span>
          <span className="text-sm text-[var(--fg-primary)] font-medium">
            {ai.id} · {ai.model}
          </span>
          <span className="text-[11px] text-[var(--fg-muted)]">
            {ai.mode === "cloud" ? "Cloud" : "Local"}
          </span>
        </section>

        <button
          type="button"
          onClick={() => openSettings("ai")}
          className="self-start inline-flex items-center gap-2 h-8 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--fg-inverse)] hover:bg-[var(--accent-bright)] text-sm font-medium"
        >
          <Gear size={14} />
          Configurar agente
        </button>

        <p className="text-[11px] text-[var(--fg-muted)] mt-auto pt-4 border-t border-[var(--border-subtle)]">
          Las API keys se almacenan en el keychain del sistema operativo.
          Cambiá proveedor, modelo o credenciales desde
          {" "}<strong>Configuración → Agente</strong>.
        </p>
      </div>
    </aside>
  );
}
