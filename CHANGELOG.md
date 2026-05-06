# Changelog

All notable changes to Daisu IDE are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (pre-1.0 — minor bumps may break).

## [Unreleased]

## [0.4.0-m4] — 2026-05-06

**M3 + M4 milestones close.** Agent foundations, LSP runtime, embedded terminal.

### Added — M3 Agent foundations

- **Provider abstraction** — Anthropic, OpenAI, Google, OpenRouter, Ollama with dynamic model listing per provider; OS-locale autodetect of Ollama install + best-coder-model heuristic
- **Agentic tool loop** — unified registry, dispatch with permission gating, persistent conversations, message split with `tool_name` field, inline streaming
- **Workspace symbol index** — rebuild + search Tauri commands, status query, symbol palette wired
- **MCP client** — connect / disconnect / status / list-tools / call-tool, per-server lifecycle
- **Inline edits** — propose / apply / reject overlay backed by per-edit Tauri commands
- **Command palette** — Ctrl+P / Ctrl+Shift+P via Radix Dialog + fuzzysort, foundation for agent commands

### Added — M4 Language server + terminal

- **`daisu-lsp` crate** — hand-rolled LSP multiplexor over `lsp-types` + tokio: framing, transport (writer / reader / stderr drain), dispatcher, JSON-RPC correlator with cancel, `NotificationBus`, document `Lifecycle` with 200 ms didChange debounce
- **Workspace trust gate** — explicit grant / revoke / is-trusted, marker stored under `~/.daisu/lsp-trust`, dialog flow with chip in status bar
- **Configurable servers** — `~/.daisu/lsp.toml` with defaults for `rust-analyzer`, `tsserver`, `pyright`, `gopls`, `clangd`; PATH-based discovery with Windows extension probing
- **Capability-gated providers** — completion, hover, signature help, definition, references, document symbol, workspace symbol, prepareRename + rename, formatting + range formatting, inlay hints, semantic tokens, code actions + execute command, all wired to Monaco
- **Diagnostics** — backend cache + broadcast, Tauri event emit, frontend store + Problems panel with severity totals badge, Monaco markers via path-based model lookup
- **Crashed-state surfacing** — `LspServerStatusChip` polls statuses, shows underlying handshake / spawn error in tooltip; bounded stderr ringbuffer per server captures the first 64 lines for context
- **`daisu-term` crate + embedded terminal** — PTY-backed xterm.js panel with size sync, kill on close, multi-instance via `Ctrl+\``
- **Shell selector + profile detection** — PowerShell, Cmd, Git Bash, installed WSL distros enumerated and switchable

### Changed

- Workspace `version` bumped from `0.2.0` to `0.4.0`
- `ServerStatus` gains optional `lastError` field; `ResolutionPublic::Found` switched from tuple to struct variant (serde-tagged enums require struct variants for tagged newtypes)
- `open_workspace` is now idempotent for the same path and returns whether it newly opened, gating the `lsp://workspace-opened` event so duplicate trust-chip mounts no longer nuke running clients
- `trackModelOpen` takes an explicit `filePath`; LSP feature adapters resolve paths via the new `pathOfModel` helper instead of reading `model.uri.fsPath` (the synthetic `daisu://tab/<id>` URI breaks every backend lookup)
- `startDiagnosticsListener` and `startWorkspaceOpenedListener` hoisted to App boot — Tauri events do not buffer, so the listeners must exist before any workspace-open / trust-grant fires
- `flushPendingChange` accepts a model or a path string instead of a Monaco URI
- `perform_initialize` races against `stdout_eof` and a 20 s timeout; failures include the captured stderr tail in the error message

### Fixed

- LSP was silently dead in five layered ways: (1) handshake hung forever when the spawned binary exited before replying — typical of the rustup proxy stub at `~/.cargo/bin/rust-analyzer` when the component is not installed; (2) repeated trust-chip mount nuked running clients; (3) diagnostics published before the lazy `<BottomPanel>` mounted were dropped; (4) didOpen sent synthetic `/tab/<uuid>` paths that backend `language_for` rejected; (5) every adapter and the markers bridge read the synthetic URI, so even a healthy server produced no UI signal

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

[Unreleased]: https://github.com/matiaspalmac/daisu-ide/compare/v0.4.0-m4...HEAD
[0.4.0-m4]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.4.0-m4
[0.0.6-m1-phase5]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.0.6-m1-phase5
[0.0.5-m1-phase4]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.0.5-m1-phase4
[0.0.4-m1-phase3]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.0.4-m1-phase3
[0.0.3-m1-phase2]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.0.3-m1-phase2
[0.0.2-m1-phase1]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.0.2-m1-phase1
[0.0.1-m0]: https://github.com/matiaspalmac/daisu-ide/releases/tag/v0.0.1-m0
