# Contributing to Daisu IDE

Thanks for considering a contribution. This document covers the workflow, the test gate that every PR must pass, and the conventions the codebase uses.

## Ways to contribute

- **Report a bug** — open an issue using the *Bug report* template. Include OS build, Daisu version (`Help → About` once shipped, or the tag you built from), steps to reproduce, expected vs actual.
- **Propose a feature** — open an issue using the *Feature request* template. Describe the user pain first, then the proposed shape. Roadmap-aligned suggestions land faster.
- **Send a PR** — fork → branch → push → PR. Small focused PRs merge faster than sweeping refactors.
- **Improve docs** — README, this file, code comments. Doc-only PRs are always welcome.

## Development setup

See [the README build section](./README.md#build-from-source) for prerequisites and the dev/build commands.

## Branch + commit conventions

- **Branch names:** `<scope>/<short-description>` — e.g. `m2/lsp-foundation`, `fix/sidebar-rename-race`, `docs/contributing`.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/). Subject lowercase (camelCase API names allowed). Header ≤ 100 characters, enforced by commitlint.

  Allowed types: `feat`, `fix`, `docs`, `chore`, `ci`, `build`, `test`, `refactor`, `perf`, `style`.

  Examples:
  ```
  feat(ui): add language picker statusbar segment
  fix(app): cancel inflight search before issuing new request_id
  test(app): add cancellation cases to streaming searcher
  ```

- **One logical change per commit.** A commit that breaks a consumer must include the consumer migration in the same commit (Husky pre-commit runs project-wide typecheck — half-done store rewrites will fail to commit).

## Test gate (required before opening a PR)

```powershell
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm typecheck
pnpm test
```

All five must pass. Workspace clippy is pedantic; minimal `#[allow(...)]` attributes are acceptable when clippy demands them, but justify it in the diff.

If `cargo fmt --check` fails, run `cargo fmt --all` and re-stage. **Do not bypass hooks** with `--no-verify`.

## Pull request checklist

- [ ] Branch is up to date with `main`
- [ ] All five test-gate commands pass locally
- [ ] New or changed behavior has tests (Rust integration tests under `crates/daisu-app/tests/` or vitest under `apps/ui/tests/`)
- [ ] Public APIs have doc comments; Rust `# Errors` / `# Panics` sections where applicable
- [ ] Commit history is clean (squash trivial fixups before opening the PR)
- [ ] PR description summarizes *what* and *why*, links related issues

## Architecture notes for contributors

- **Stores break consumers in the same commit.** When you rename a Zustand store action or change a returned shape, every component that reads it must compile in the same commit. Husky pre-commit will refuse partial migrations.
- **Monaco namespace is injected, not imported at runtime.** Never write `import * as monaco from "monaco-editor"` outside a type-only context — it bundles the entire 1.2 MB namespace into the production chunk. The namespace is captured via `@monaco-editor/react`'s `onMount` callback and exposed through `apps/ui/src/lib/monaco-editor-ref.ts`.
- **Backend commands return typed results via `AppResult<T>`.** Frontend wrappers in `apps/ui/src/api/tauri.ts` handle the snake_case ↔ camelCase remap.
- **Tests use real fixtures, not heavy mocks.** Rust integration tests use `tempfile::tempdir()`. Frontend store tests stub the Tauri command layer at `apps/ui/src/api/tauri` only.
- **`docs/` is intentionally not committed** — internal planning documents live there for the maintainer's workflow but are not part of the public repo. Don't re-add it.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating, you agree to abide by it.

## License

By contributing, you agree your contributions are licensed under the MIT license that covers this project.
