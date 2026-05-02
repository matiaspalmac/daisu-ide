// Function form: lint-staged passes staged filenames as the argument
// but functions can ignore them and return the command to run.
// We run project-wide typecheck/fmt instead of per-file because tsc
// without project config fails on JSX/path-resolution.
export default {
  "apps/ui/**/*.{ts,tsx}": () => "pnpm --filter @daisu/ui run typecheck",
  "crates/**/*.rs": () => "cargo fmt --all -- --check",
};
