const SEP_RE = /[\\/]/;

/** Names shorter than this fall back to "parent/name" to disambiguate
 * common short roots like `src`, `apps`, `ui`, `lib`. */
const MIN_UNIQUE_NAME_LEN = 5;

export function basename(path: string): string {
  if (path === "") return "";
  const trimmed = path.replace(/[\\/]+$/u, "");
  if (trimmed === "") return "";
  const parts = trimmed.split(SEP_RE);
  return parts[parts.length - 1] ?? "";
}

export function parent(path: string): string {
  const trimmed = path.replace(/[\\/]+$/u, "");
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (idx <= 0) return path.includes(":") ? `${path.slice(0, 2)}\\` : "";
  const head = trimmed.slice(0, idx);
  if (/^[A-Za-z]:$/u.test(head)) return `${head}\\`;
  return head;
}

export function joinPath(base: string, child: string): string {
  const trimmedBase = base.replace(/[\\/]+$/u, "");
  const trimmedChild = child.replace(/^[\\/]+/u, "");
  return `${trimmedBase}\\${trimmedChild}`;
}

/**
 * Display-friendly name for a path. Returns the basename when it's
 * likely unique (>= 5 chars); otherwise prefixes the parent dir to
 * disambiguate common short roots like `src`, `apps`, `ui`, `lib`.
 */
export function displayName(path: string): string {
  const name = basename(path);
  if (name.length >= MIN_UNIQUE_NAME_LEN) return name;
  const parentDir = basename(parent(path));
  return parentDir ? `${parentDir}/${name}` : name;
}
