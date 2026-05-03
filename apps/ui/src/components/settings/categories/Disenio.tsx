import type { JSX } from "react";

interface DesignCardProps {
  title: string;
  desc: string;
  toggleLabel?: string;
}

function DesignCard({ title, desc, toggleLabel }: DesignCardProps): JSX.Element {
  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 flex flex-col gap-2 min-h-[120px]">
      <div>
        <h4 className="text-sm font-medium text-[var(--fg-primary)]">{title}</h4>
        <p className="text-xs text-[var(--fg-secondary)] mt-0.5">{desc}</p>
      </div>
      <div className="flex items-end justify-between mt-auto gap-2">
        <span className="text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">
          {toggleLabel ?? "Toggle"}
        </span>
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-9 items-center rounded-full bg-[var(--warn)] shadow-[var(--glow-orange-sm)] px-0.5"
        >
          <span className="block h-4 w-4 rounded-full bg-white translate-x-4" />
        </span>
      </div>
    </div>
  );
}

export function Disenio(): JSX.Element {
  return (
    <div className="daisu-settings-panel">
      <header className="border-b border-[var(--border-subtle)] pb-3 mb-6">
        <h2 className="text-base font-semibold text-[var(--fg-primary)]">Diseño</h2>
        <p className="text-xs text-[var(--fg-secondary)]">
          Personaliza la disposición de los componentes de la interfaz
        </p>
      </header>

      <section className="mb-8">
        <h3 className="text-sm font-medium mb-3 text-[var(--fg-primary)]">
          Componentes
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <DesignCard
            title="Barra de actividad"
            desc="Navegación principal con acceso a explorador, búsqueda y extensiones"
          />
          <DesignCard
            title="Barra de estado"
            desc="Información de estado del editor y proyecto"
          />
          <DesignCard
            title="Panel lateral"
            desc="Panel con explorador de archivos, búsqueda y otras herramientas"
          />
          <DesignCard
            title="Terminal"
            desc="Terminal integrada para ejecutar comandos"
          />
          <DesignCard
            title="Panel de chat"
            desc="Panel de chat con IA para asistencia de código"
          />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium mb-1 text-[var(--fg-primary)]">
          Botones de paneles
        </h3>
        <p className="text-xs text-[var(--fg-secondary)] mb-3">
          Controla dónde se muestran los botones para alternar paneles.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <DesignCard title="Ubicación" desc="Dónde se muestran los botones de paneles" />
          <DesignCard title="Panel lateral" desc="Mostrar u ocultar este botón" />
          <DesignCard title="Terminal" desc="Mostrar u ocultar este botón" />
          <DesignCard title="Chat" desc="Mostrar u ocultar este botón" />
        </div>
      </section>

      <p className="text-[11px] text-[var(--fg-muted)] mt-8">
        Funcionalidad de toggles aplicará al layout en M2 Phase 8 final.
      </p>
    </div>
  );
}
