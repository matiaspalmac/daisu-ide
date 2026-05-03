# Changelog

All notable changes to Daisu IDE are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (pre-1.0 — minor bumps may break).

## [Unreleased]

## [0.0.6-m1-phase5] — 2026-05-02

**M1 milestone closes.** Status bar, search & replace, git overlay.

### Added

- **Backend search subsystem** — ignore-aware walker (`.gitignore` + user globs), regex matcher with case / whole-word / multiline modes, streaming searcher with cancellation registry and 50 ms throttle, atomic per-file replacer
- **Backend git overlay** — cached `Arc<Mutex<Repository>>`, 4-status enum (Modified / Untracked / Conflict / Staged) with explicit precedence, branch list / checkout / fetch via `git2`
- **`notify-rs` git watcher** — listens on `.git/index` and `.git/HEAD` with 500 ms debounce; emits `git-changed` Tauri event
- **EOL conversion** — `convert_eol` Tauri command, atomic LF↔CRLF rewrite via tempfile + rename
- **Encoding-aware read** — `read_file_with_encoding` Tauri command using `encoding_rs` (UTF-8, UTF-16LE/BE, Windows-1252)
- **Status bar segments** — cursor (`Ln, Col`), EOL, encoding, indent, language picker, branch picker, search progress (all clickable)
- **Branch picker** — Radix Popover with filterable list and dirty-tree force-checkout `AlertDialog`
- **Language picker** — Radix Popover with cached Monaco language list and search filter
- **Search panel** — `SearchInput` + `ReplaceInput` + `GlobFilters` + `ResultsList` + `ResultLine` + `ReplaceConfirmDialog` with streaming event listeners
- **Sidebar + tab git decoration** — file tree nodes and tab names tinted by git status with single-letter badges (M/U/C/S)
- **`useGitWatcher`** — listens to `git-changed` and window focus events; refreshes `gitStore`
- **`useEditorCursorWiring`** — subscribes Monaco cursor + selection events into `editorCursorStore`
- **Frontend stores** — `editorCursorStore`, full rewrites of `searchStore` and `gitStore`, `tabsStore` extension with `eol` / `encoding` / `setLanguage`

### Changed

- `OpenedFile` Tauri response now includes `eol` and `encoding` fields
- `OpenTab` and `ClosedTabSnapshot` extended with `eol` and `encoding`; session schema uses Zod `.default()` for backward compatibility
- `AppState` extended with `git_cancel: Arc<CancellationToken>` and `git_watcher: Mutex<Option<RecommendedWatcher>>`
- `open_workspace` now spawns the git watcher when `.git` exists; `close_workspace` drops it and invalidates the repo cache

## [0.0.5-m1-phase4] — 2026-05-02

**M1 Phase 4.** Themes + settings + keybindings.

### Added

- VS Code JSON theme loader with 34-rule scope-token-map (Spike D validated 100% coverage)
- Bundled themes — `daisu-dark` (default) and `daisu-light`
- Settings UI modal with categorized navigation (general, editor, themes, keybindings)
- Keybinding registry — 20 distinct actions with `tinykeys`, customizable per binding
- `useTheme` and `useKeybindings` hooks
- Theme auto-switch on system preference change

## [0.0.4-m1-phase3] — 2026-04-29

**M1 Phase 3.** Tabs + multi-buffer.

### Added

- Multi-buffer tab system with pin, MRU cycle, close-others, reopen recently closed
- Dirty-state confirmation modal (single + batch close)
- Drag-and-drop tab reorder with pinned-segment clamp
- Session restore (per workspace)
- Monaco model lifecycle management

## [0.0.3-m1-phase2] — 2026-04-25

**M1 Phase 2.** File tree + workspace.

### Added

- Rust workspace walker with cancellation, batched tree emission
- `notify-rs` filesystem watcher with debounce
- File tree (`react-arborist`) with rename, create, delete-to-trash, copy, drag-and-drop reorder
- Drag-and-drop folder open from OS

## [0.0.2-m1-phase1] — 2026-04-22

**M1 Phase 1.** Foundation.

### Added

- Workspace store with hash-based session key
- File-ops Tauri commands (`open_file`, `save_file`, `list_dir`, `create_file`, `create_dir`, `rename_path`, `delete_to_trash`, `restore_from_trash`, `copy_path`)
- `validation::validate_filename` (Windows-reserved name and illegal character checks)

## [0.0.1-m0] — 2026-04-20

**M0 Bootstrap.**

### Added

- Tauri 2 + React 19 + Vite scaffold
- Monaco editor mount with theme provider stub
- Husky + lint-staged + commitlint pre-commit gate (`cargo fmt --check`, project-wide `pnpm typecheck`)
- GitHub Actions quality workflow
- Initial CLAUDE.md / superpowers planning workflow

[Unreleased]: https://github.com/matiaspalmac/daisu-ide/compare/v0.0.6-m1-phase5...HEAD
[0.0.6-m1-phase5]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.0.6-m1-phase5
[0.0.5-m1-phase4]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.0.5-m1-phase4
[0.0.4-m1-phase3]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.0.4-m1-phase3
[0.0.3-m1-phase2]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.0.3-m1-phase2
[0.0.2-m1-phase1]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.0.2-m1-phase1
[0.0.1-m0]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.0.1-m0
