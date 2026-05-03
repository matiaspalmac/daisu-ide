<div align="center">

# Daisu IDE

**A lightweight, AI-agent-native code editor for Windows.**
Built with Tauri 2 + React 19 + Monaco. Native shell, no Electron.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/matiaspalmac/daisu-ide/actions/workflows/quality.yml/badge.svg)](https://github.com/matiaspalmac/daisu-ide/actions/workflows/quality.yml)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.84+-orange.svg)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-yellow.svg)](#roadmap)

</div>

---

## What is Daisu?

Daisu is an open-source code editor designed from the ground up for **multi-agent autonomous coding**. It pairs a familiar editor surface (Monaco, file tree, tabs, status bar, search & replace, git overlay) with first-class hooks for AI agents that read code, edit code, run commands, and remember context across sessions.

The goal is not to bolt AI onto VS Code. The goal is an editor where the agent loop is a primary citizen — alongside the keyboard, the file system, and the language server — running on a small, fast, native Windows shell.

## Why another editor?

- **Native shell.** Tauri 2 + Rust. Fast cold start, low RAM, real OS integration. No Chromium runtime.
- **AI-agent-native.** Designed around long-running agents with persistent memory and provider-agnostic LLM access (cloud + local). Not a chat sidebar bolted onto a generic editor.
- **MIT, no telemetry.** Yours to read, fork, and ship.
- **Windows-first.** Built and tested on Windows 10/11 with WebView2. Cross-platform comes after the agent loop is solid.

## Features (today)

Editor essentials are landing milestone-by-milestone. As of `v0.0.6-m1-phase5`:

- **Editor** — Monaco with theme support (VS Code JSON themes), settings UI, keybinding registry (20+ actions, customizable)
- **Workspace** — fast Rust-side directory walker with cancellation, ignore-aware (`.gitignore`), drag-and-drop folder open
- **File tree** — react-arborist with rename, create, delete-to-trash, copy, drag-and-drop reorder
- **Tabs** — multi-buffer, pin, MRU cycle, recently-closed reopen, dirty-state confirm modal, session restore
- **Status bar** — cursor / EOL / encoding / indent / language picker / branch picker / search progress (all clickable)
- **Search & Replace** — workspace-wide ripgrep-style search with streaming hits, cancellation, regex / case / whole-word / multiline, atomic per-file replace, exclude/include globs
- **Git overlay** — branch + ahead/behind, file-status tint (Modified / Untracked / Conflict / Staged), branch picker with dirty-tree force-checkout dialog, fetch, notify-rs watcher on `.git/index` and `.git/HEAD`
- **EOL / encoding tools** — convert LF↔CRLF in place, reload with alternate encoding (UTF-8 / UTF-16 / Windows-1252)

## Roadmap

Daisu is shipped phase-by-phase. Each milestone is a tagged release.

| Milestone | Status | Tag |
|---|---|---|
| **M0** Bootstrap | shipped | `v0.0.1-m0` |
| **M1** Editor base — workspace, tabs, themes, settings, keybindings, status bar, search & replace, git overlay | shipped | `v0.0.6-m1-phase5` |
| **M2** Polish + diagnostics — LSP integration, conflict resolution UI, theme customization, custom keybinding chord support | planned | — |
| **M3** Agent foundations — provider abstraction, agent runtime, persistent memory store | planned | — |
| **M4** Multi-agent orchestration — agent inbox, parallel agent execution, audit trail | planned | — |
| **M5** Extension host — Open VSX-compatible web-extension runtime | planned | — |

## Build from source

**Requirements**

- Windows 10 or 11 with WebView2 Runtime ([install if missing](https://developer.microsoft.com/microsoft-edge/webview2/))
- Rust 1.84 or newer (`rustup`)
- Node 22 + pnpm 10 (`corepack enable && corepack prepare pnpm@10 --activate`)
- Tauri CLI 2: `cargo install tauri-cli --version "^2.0" --locked`

**Build**

```powershell
pnpm install
pnpm tauri dev          # development with HMR
pnpm tauri build        # release build → target\release\daisu.exe
```

**Test gate (run before opening a PR)**

```powershell
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-features
pnpm typecheck
pnpm test
```

## Project structure

```
.
├── apps/ui/                  # React 19 + Vite frontend
│   ├── src/
│   │   ├── api/              # Typed Tauri command wrappers
│   │   ├── components/       # Editor, sidebar, tabs, statusbar, search...
│   │   ├── hooks/            # useTheme, useKeybindings, useGitWatcher...
│   │   ├── lib/              # Pure helpers (theme-loader, glob-defaults...)
│   │   └── stores/           # Zustand stores (tabs, workspace, settings, search, git...)
│   └── tests/                # Vitest + React Testing Library
└── crates/daisu-app/         # Rust + Tauri backend
    ├── src/
    │   ├── commands/         # Tauri command surface
    │   ├── git/              # git2 overlay (status, branch, repo cache)
    │   ├── search/           # ignore + grep-searcher streaming search
    │   └── watch/            # notify-rs filesystem + git watchers
    └── tests/                # Rust integration tests
```

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow, commit conventions, and the test gate. By participating you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Please review [SECURITY.md](./SECURITY.md) before opening a public issue.

## License

MIT © 2026 Matias Palma. See [LICENSE](./LICENSE).
