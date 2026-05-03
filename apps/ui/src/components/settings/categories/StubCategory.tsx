import type { JSX } from "react";

interface Props {
  title: string;
  message?: string;
}

export function StubCategory({ title, message }: Props): JSX.Element {
  return (
    <div className="daisu-settings-panel">
      <header className="border-b border-[var(--border-subtle)] pb-3 mb-6">
        <h2 className="text-base font-semibold text-[var(--fg-primary)]">{title}</h2>
      </header>
      <p className="text-sm text-[var(--fg-secondary)]">
        {message ?? "Próximamente — esta categoría llega en milestones futuros."}
      </p>
    </div>
  );
}
