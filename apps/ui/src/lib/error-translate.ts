// Maps the structured AppError envelope (from Tauri commands) to user copy.
// Component code uses translateError() in catch blocks — never reads kind directly.

export type AppErrorKind =
  | "NotFound"
  | "PermissionDenied"
  | "AlreadyExists"
  | "InvalidName"
  | "IoError"
  | "WatcherError"
  | "Cancelled"
  | "InvalidUtf8"
  | "Internal";

export interface AppErrorEnvelope {
  kind: AppErrorKind;
  message: string;
  context: { path?: string; name?: string; io_kind?: string } | null;
}

function isEnvelope(value: unknown): value is AppErrorEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value &&
    "context" in value
  );
}

export function translateError(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (!isEnvelope(value)) return String(value);

  const path = value.context?.path ?? "";
  switch (value.kind) {
    case "NotFound":
      return path ? `Path not found: ${path}` : "Path not found.";
    case "PermissionDenied":
      return path ? `Permission denied: ${path}` : "Permission denied.";
    case "AlreadyExists":
      return path ? `Already exists: ${path}` : "Already exists.";
    case "InvalidName":
      return `Invalid name: ${value.message}`;
    case "WatcherError":
      return "File watcher error. The tree may be out of date.";
    case "Cancelled":
      return "Operation cancelled.";
    case "InvalidUtf8":
      return "File is not valid UTF-8.";
    case "IoError":
      return value.message || "I/O error.";
    case "Internal":
      return value.message || "Internal error.";
    default:
      return value.message || "Unknown error.";
  }
}
