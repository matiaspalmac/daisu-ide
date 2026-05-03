<div align="center">

<img src="./crates/daisu-app/icons/daisu-logo.png" alt="Daisu IDE" width="128" />

# Daisu IDE

**A calm, AI-agent-native code editor for Windows.**
Built with Tauri 2 + React 19 + Monaco. Native shell, no Electron. Designed to disappear so the work breathes.

[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm--NC--1.0.0-d4a574.svg)](./LICENSE)
[![CI](https://github.com/matiaspalmac/daisu-ide/actions/workflows/quality.yml/badge.svg)](https://github.com/matiaspalmac/daisu-ide/actions/workflows/quality.yml)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.84+-orange.svg)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-yellow.svg)](#roadmap)

</div>

---

## What is Daisu?

Daisu (大) is an open-source code editor designed from the ground up for **multi-agent autonomous coding**. It pairs a familiar editor surface (Monaco, file tree, tabs, status bar, search & replace, git overlay) with first-class hooks for AI agents that read code, edit code, run commands, and remember context across sessions.

The goal is not to bolt AI onto VS Code. The goal is an editor where the agent loop is a primary citizen — alongside the keyboard, the file system, and the language server — running on a small, fast, native Windows shell with an interface that feels intentional and quiet.

## Why another editor?

- **Native shell.** Tauri 2 + Rust. Fast cold start, low RAM, real OS integration. No Chromium runtime.
- **AI-agent-native.** Designed around long-running agents with persistent memory and provider-agnostic LLM access (cloud + local). Not a chat sidebar bolted onto a generic editor.
- **Daisu Nocturne identity.** A warm sumi-ink palette with a single kintsugi gold accent. Thin Phosphor strokes, restrained motion, kanji cues for navigation. Built to be relaxing for long sessions.
- **Source-available, no telemetry.** Read, fork, and modify freely for noncommercial use. See [LICENSE](./LICENSE).
- **Windows-first.** Built and tested on Windows 10/11 with WebView2. Cross-platform comes after the agent loop is solid.

## Features (today)

Editor essentials are landing milestone-by-milestone.

**Editor**
- Monaco with theme support, daisu-nocturne registered before any editor mounts (no vs-dark flash on workspace re-open)
- File path breadcrumb above the editor with gold-dot separators
- Settings UI, keybinding registry (20+ actions, customizable)

**Workspace + sidebar**
- Fast Rust-side directory walker with cancellation, ignore-aware (`.gitignore`), drag-and-drop folder open
- File tree with rename, create, delete-to-trash, copy, drag-and-drop reorder (react-arborist)
- Always-on inline filter, pinned-files region (persisted per workspace)
- Sidebar swaps between **explorer** and **search** in place — no bottom split — with a kanji header (木 / 検)
- Double-click on a resize handle auto-fits the panel to its content (à la VS Code)

**Tabs**
- Multi-buffer, pin, MRU cycle, recently-closed reopen, dirty-state confirm modal, session restore
- Subtle gold dirty-dot indicator that brightens on the active tab

**Status bar + title bar**
- Cursor / EOL / encoding / indent / language picker / search progress (all clickable)
- Centered workspace pill: 場 + project name + git branch with ahead/behind counters
- Centered title-bar clock pill with kanji period glyph (朝/昼/夕/夜) + monospaced HH:MM
- Focus mode (`Ctrl+\`) that hides chrome and lets the editor breathe edge-to-edge

**Search & Replace**
- Workspace-wide ripgrep-style search with streaming hits, cancellation
- Regex / case / whole-word / multiline toggles
- Atomic per-file replace, include/exclude globs

**Git overlay**
- Branch + ahead/behind, file-status tint (Modified / Untracked / Conflict / Staged)
- Branch picker with dirty-tree force-checkout dialog, fetch, notify-rs watcher on `.git/index` and `.git/HEAD`

**EOL / encoding tools**
- Convert LF ↔ CRLF in place, reload with alternate encoding (UTF-8 / UTF-16 / Windows-1252)

**Integrations**
- Native Discord Rich Presence (Zed-style layout, calm assets, throttled, opt-out toggles in settings)

**Welcome ritual**
- Zen vertical layout with a daily haiku (one classic per day, deterministic by day-of-year)
- Time-of-day greeting and quick actions with shortcut hints

## Roadmap

Daisu is shipped phase-by-phase. Each milestone is a tagged release.

| Milestone | Status | Tag |
|---|---|---|
| **M0** Bootstrap | shipped | `v0.0.1-m0` |
| **M1** Editor base — workspace, tabs, themes, settings, keybindings, status bar, search & replace, git overlay | shipped | `v0.0.6-m1-phase5` |
| **M2** Tron UI overhaul — Tailwind v4 + shadcn + Monaco + welcome + chat + settings | shipped | `v0.1.0-m2` |
| **M2.1** Daisu Nocturne identity — sumi-ink palette, Phosphor icons, kanji cues, breadcrumb, focus mode, sidebar swap, paper-card toasts, Discord RPC, refreshed branding | shipped | `main` |
| **M3** Agent foundations — provider abstraction, agent runtime, persistent memory store, command palette | planned | — |
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

## Discord Rich Presence

Daisu ships with native Discord RPC enabled by default. While Discord is running, your activity will read:

```
Daisu
In <project>
Editing <file>     ← or "Idling" when no tab is open
🎨 elapsed time
```

Toggle it (or hide file/project names for privacy) in **Settings → Integraciones**. The default Application ID is bundled and ready to go; bring your own ID if you want to customise the assets.

## Project structure

```
.
├── apps/ui/                  # React 19 + Vite frontend
│   ├── src/
│   │   ├── api/              # Typed Tauri command wrappers
│   │   ├── components/       # Editor, sidebar, tabs, statusbar, search…
│   │   ├── hooks/            # useTheme, useKeybindings, useGitWatcher, useDiscordRpc…
│   │   ├── lib/              # Pure helpers (theme-loader, glob-defaults…)
│   │   └── stores/           # Zustand stores (tabs, workspace, settings, search, git…)
│   └── tests/                # Vitest + React Testing Library
└── crates/daisu-app/         # Rust + Tauri backend
    ├── icons/                # Daisu logo + app icon set + Discord RPC assets
    ├── src/
    │   ├── commands/         # Tauri command surface (incl. discord.rs)
    │   ├── git/              # git2 overlay (status, branch, repo cache)
    │   ├── search/           # ignore + grep-searcher streaming search
    │   └── watch/            # notify-rs filesystem + git watchers
    └── tests/                # Rust integration tests
```

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow, commit conventions, and the test gate. By participating you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

Note: Daisu is source-available under PolyForm Noncommercial. Contributions are accepted under the same terms.

## Security

Found a vulnerability? Please review [SECURITY.md](./SECURITY.md) before opening a public issue.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) © 2026 Matias Palma.

You are free to use, modify, and redistribute Daisu for any noncommercial purpose — personal projects, hobby work, education, research, charitable or government use. Selling Daisu (or substantial parts of it), offering it as a paid service, or any other commercial use is not permitted. Forks are welcome; commercial forks are not.
