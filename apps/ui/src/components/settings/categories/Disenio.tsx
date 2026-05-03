import type { JSX } from "react";
import { useSettings } from "../../../stores/settingsStore";

type Side = "left" | "right";

interface DesignCardProps {
  title: string;
  desc: string;
  selectKey?: keyof Pick<
    DesignSettings,
    "activityBarSide" | "sidebarSide" | "rightPanelSide"
  >;
  selectOptions?: Array<{ value: Side; label: string }>;
  toggleKey?: keyof Pick<
    DesignSettings,
    | "activityBarVisible"
    | "statusBarVisible"
    | "sidebarVisible"
    | "rightPanelVisible"
    | "terminalVisible"
    | "statusBarPanelToggles"
    | "statusBarUtility"
    | "titleBarHamburger"
    | "titleBarMenuStrip"
    | "titleBarUserAvatar"
  >;
}

interface DesignSettings {
  activityBarSide: Side;
  activityBarVisible: boolean;
  statusBarVisible: boolean;
  sidebarSide: Side;
  sidebarVisible: boolean;
  rightPanelSide: Side;
  rightPanelVisible: boolean;
  terminalVisible: boolean;
  statusBarPanelToggles: boolean;
  statusBarUtility: boolean;
  titleBarHamburger: boolean;
  titleBarMenuStrip: boolean;
  titleBarUserAvatar: boolean;
}

const SIDE_OPTIONS: Array<{ value: Side; label: string }> = [
  { value: "left", label: "Izquierda" },
  { value: "right", label: "Derecha" },
];

function DesignCard(props: DesignCardProps): JSX.Element {
  const design = useSettings((s) => s.settings.design) as DesignSettings;
  const setSetting = useSettings((s) => s.set);

  const onToggle = (): void => {
    if (!props.toggleKey) return;
    void setSetting("design", { [props.toggleKey]: !design[props.toggleKey] });
  };
  const onSelect = (v: Side): void => {
    if (!props.selectKey) return;
    void setSetting("design", { [props.selectKey]: v });
  };

  const isOn = props.toggleKey ? design[props.toggleKey] : false;

  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 flex flex-col gap-2 min-h-[120px]">
      <div>
        <h4 className="text-sm font-medium text-[var(--fg-primary)]">{props.title}</h4>
        <p className="text-xs text-[var(--fg-secondary)] mt-0.5">{props.desc}</p>
      </div>
      <div className="flex items-end justify-between mt-auto gap-2">
        {props.selectKey && props.selectOptions ? (
          <select
            value={design[props.selectKey]}
            onChange={(e) => onSelect(e.target.value as Side)}
            className="daisu-select max-w-[140px] text-xs bg-[var(--bg-base)] border-[var(--border-subtle)]"
          >
            {props.selectOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <span />
        )}
        {props.toggleKey && (
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={isOn}
            aria-label={`Toggle ${props.title}`}
            className={
              "inline-flex h-5 w-9 items-center rounded-full transition-colors px-0.5 " +
              (isOn
                ? "bg-[var(--warn)] shadow-[var(--glow-orange-sm)]"
                : "bg-[var(--bg-base)] border border-[var(--border-subtle)]")
            }
          >
            <span
              className={
                "block h-4 w-4 rounded-full bg-white transition-transform " +
                (isOn ? "translate-x-4" : "translate-x-0")
              }
            />
          </button>
        )}
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <DesignCard
            title="Barra de actividad"
            desc="Navegación lateral con explorador, búsqueda y extensiones"
            selectKey="activityBarSide"
            selectOptions={SIDE_OPTIONS}
            toggleKey="activityBarVisible"
          />
          <DesignCard
            title="Barra de estado"
            desc="Información del editor y proyecto"
            toggleKey="statusBarVisible"
          />
          <DesignCard
            title="Panel lateral"
            desc="Explorador de archivos, búsqueda y otras herramientas"
            selectKey="sidebarSide"
            selectOptions={SIDE_OPTIONS}
            toggleKey="sidebarVisible"
          />
          <DesignCard
            title="Terminal"
            desc="Terminal integrada para ejecutar comandos"
            toggleKey="terminalVisible"
          />
          <DesignCard
            title="Panel de chat"
            desc="Chat con IA para asistencia de código"
            selectKey="rightPanelSide"
            selectOptions={SIDE_OPTIONS}
            toggleKey="rightPanelVisible"
          />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium mb-3 text-[var(--fg-primary)]">
          Botones de paneles
        </h3>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <DesignCard
            title="Toggles de paneles"
            desc="Botones cyan/orange en barra de estado para mostrar/ocultar paneles"
            toggleKey="statusBarPanelToggles"
          />
          <DesignCard
            title="Cluster utilitario"
            desc="Errores, advertencias, notificaciones y configuración en barra de estado"
            toggleKey="statusBarUtility"
          />
          <DesignCard
            title="Menú hamburguesa"
            desc="Botón de menú principal en barra de título"
            toggleKey="titleBarHamburger"
          />
          <DesignCard
            title="Barra de menús"
            desc="Archivo, Edición, Selección, Vista, Terminal en barra de título"
            toggleKey="titleBarMenuStrip"
          />
          <DesignCard
            title="Avatar de usuario"
            desc="Icono de cuenta en barra de título"
            toggleKey="titleBarUserAvatar"
          />
        </div>
      </section>

      <p className="text-[11px] text-[var(--fg-muted)] mt-4">
        Cambios aplican en vivo. Persisten en almacenamiento local.
      </p>
    </div>
  );
}
