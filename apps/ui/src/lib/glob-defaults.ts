export const DEFAULT_EXCLUDE_GLOBS: string[] = [
  "node_modules/**",
  "dist/**",
  "target/**",
  ".git/**",
  ".cache/**",
  "build/**",
  "out/**",
];

export function mergeExcludeGlobs(userGlobs: string[]): string[] {
  const set = new Set<string>(DEFAULT_EXCLUDE_GLOBS);
  for (const g of userGlobs) {
    const trimmed = g.trim();
    if (trimmed.length > 0) set.add(trimmed);
  }
  return Array.from(set);
}
