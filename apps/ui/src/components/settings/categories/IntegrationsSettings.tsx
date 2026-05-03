import type { JSX } from "react";
import { ToggleField } from "../controls/ToggleField";
import { useSettings } from "../../../stores/settingsStore";

export function IntegrationsSettings(): JSX.Element {
  const appId = useSettings((s) => s.settings.integrations.discordAppId);
  const setSetting = useSettings((s) => s.set);

  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">Integraciones</h2>

      <h3 className="daisu-settings-section-title">Discord Rich Presence</h3>
      <p className="daisu-settings-section-desc">
        Muestra en tu perfil de Discord lo que estás editando. Requiere Discord
        abierto en el equipo. Si Discord no está activo, la conexión falla
        silenciosamente.
      </p>

      <ToggleField
        category="integrations"
        field="discordRpcEnabled"
        label="Activar Discord Rich Presence"
        description="Conecta a Discord al iniciar Daisu y publica actividad."
      />
      <ToggleField
        category="integrations"
        field="discordShowProject"
        label="Mostrar nombre del proyecto"
        description="Publica el nombre de la carpeta abierta como contexto."
      />
      <ToggleField
        category="integrations"
        field="discordShowFile"
        label="Mostrar archivo en edición"
        description="Publica el nombre del archivo activo. Desactiva para privacidad."
      />

      <div className="daisu-field">
        <div className="daisu-field-text">
          <label className="daisu-field-label" htmlFor="discord-app-id">
            Application ID
          </label>
          <p className="daisu-field-desc">
            ID de la aplicación de Discord (Discord Developer Portal). Usa el
            default a menos que tengas tu propia app con assets personalizados.
          </p>
        </div>
        <input
          id="discord-app-id"
          type="text"
          className="daisu-input daisu-input-mono"
          value={appId}
          onChange={(e) =>
            void setSetting("integrations", { discordAppId: e.target.value })
          }
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
