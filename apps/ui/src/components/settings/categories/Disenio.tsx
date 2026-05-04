import type { JSX } from "react";
import { useSettings } from "../../../stores/settingsStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";

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
      <div className="flex items-center justify-between mt-auto gap-2">
        {props.selectKey && props.selectOptions ? (
          <Select
            value={design[props.selectKey]}
            onValueChange={(v) => onSelect(v as Side)}
          >
            <SelectTrigger className="flex-1 min-w-0 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.selectOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="flex-1" />
        )}
        {props.toggleKey && (
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={isOn}
            aria-label={`Toggle ${props.title}`}
            className={
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors " +
              (isOn
                ? "bg-[var(--accent)]"
                : "bg-[var(--bg-base)] border border-[var(--border-subtle)]")
            }
          >
            <span
              className={
                "block h-3.5 w-3.5 rounded-full bg-[var(--fg-primary)] transition-transform shadow-sm " +
                (isOn
                  ? "translate-x-[18px] bg-[var(--bg-base)]"
                  : "translate-x-[3px]")
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
