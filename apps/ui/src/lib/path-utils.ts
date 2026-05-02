const SEP_RE = /[\\/]/;

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
  const trimmed = base.replace(/[\\/]+$/u, "");
  return `${trimmed}\\${child}`;
}

export function displayName(path: string): string {
  const name = basename(path);
  if (name.length >= 5) return name;
  const parentDir = basename(parent(path));
  return parentDir ? `${parentDir}/${name}` : name;
}
