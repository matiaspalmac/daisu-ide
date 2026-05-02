# Daisu IDE

> Lightweight, AI-agent-native IDE for Windows. Tauri 2 + React + Monaco. MIT.

**Status:** Pre-alpha (M0 Bootstrap). Not yet usable.

## Vision

Multi-agent autonomous coding with persistent memory. Cloud + local LLM provider abstraction (Anthropic, OpenAI, Google, Ollama, llama.cpp). Open VSX extension marketplace via custom web-extension host. Native Tauri shell, no Electron.

## Build from source

Requirements:
- Rust 1.84+ (`rustup`)
- Node 22 + pnpm 10
- Tauri CLI 2 (`cargo install tauri-cli --version "^2.0" --locked`)
- Windows 10/11 with WebView2 Runtime

```bash
pnpm install
pnpm tauri dev          # development with HMR
pnpm tauri build        # release build → crates/daisu-app/target/release/daisu.exe
```

## Tests

```bash
cargo test --workspace
pnpm test
pnpm typecheck
cargo clippy -- -D warnings
cargo fmt --check
```

## License

MIT © 2026 Matias Palma. See `LICENSE`.
