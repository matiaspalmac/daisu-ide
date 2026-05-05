import { type JSX } from "react";

interface Props {
  message: string;
}

export function PlaceholderView({ message }: Props): JSX.Element {
  return (
    <div className="flex items-center justify-center h-full text-[11px] text-[var(--fg-muted)]">
      {message}
    </div>
  );
}
