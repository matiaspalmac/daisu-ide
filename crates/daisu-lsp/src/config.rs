//! Server config schema and on-disk loading.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{LspError, LspResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LspConfig {
    #[serde(default)]
    pub servers: Vec<ServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerConfig {
    /// Stable identifier (used as logical name + slotmap key alias).
    pub id: String,
    /// Executable to spawn. Resolved via PATH if not absolute.
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Language ids this server handles. Matches Monaco language ids
    /// (`rust`, `typescript`, etc.) which are themselves derived from
    /// file extensions in `apps/ui/src/lib/language-list.ts`.
    pub languages: Vec<String>,
    /// Optional initialization options forwarded as `params.initializationOptions`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initialization_options: Option<serde_json::Value>,
}

impl LspConfig {
    #[must_use]
    pub fn defaults() -> Self {
        Self {
            servers: vec![
                ServerConfig {
                    id: "rust-analyzer".into(),
                    command: "rust-analyzer".into(),
                    args: vec![],
                    languages: vec!["rust".into()],
                    initialization_options: None,
                },
                ServerConfig {
                    id: "tsserver".into(),
                    command: "typescript-language-server".into(),
                    args: vec!["--stdio".into()],
                    languages: vec![
                        "typescript".into(),
                        "tsx".into(),
                        "javascript".into(),
                        "jsx".into(),
                    ],
                    initialization_options: None,
                },
                ServerConfig {
                    id: "pyright".into(),
                    command: "pyright-langserver".into(),
                    args: vec!["--stdio".into()],
                    languages: vec!["python".into()],
                    initialization_options: None,
                },
                ServerConfig {
                    id: "gopls".into(),
                    command: "gopls".into(),
                    args: vec![],
                    languages: vec!["go".into()],
                    initialization_options: None,
                },
                ServerConfig {
                    id: "clangd".into(),
                    command: "clangd".into(),
                    args: vec![],
                    languages: vec!["c".into(), "cpp".into()],
                    initialization_options: None,
                },
            ],
        }
    }

    pub fn load(path: &Path) -> LspResult<Self> {
        if !path.exists() {
            return Ok(Self::defaults());
        }
        let raw = std::fs::read_to_string(path)?;
        let parsed: LspConfig = toml::from_str(&raw)?;
        Ok(parsed)
    }

    pub fn save(&self, path: &Path) -> LspResult<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let raw = toml::to_string_pretty(self).map_err(|e| LspError::Trust(e.to_string()))?;
        std::fs::write(path, raw)?;
        Ok(())
    }

    /// Returns servers configured for the given Monaco language id.
    #[must_use]
    pub fn for_language(&self, language: &str) -> Vec<&ServerConfig> {
        self.servers
            .iter()
            .filter(|s| s.languages.iter().any(|l| l == language))
            .collect()
    }
}

impl Default for LspConfig {
    fn default() -> Self {
        Self::defaults()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_include_rust_analyzer_and_tsserver() {
        let c = LspConfig::defaults();
        assert!(c.servers.iter().any(|s| s.id == "rust-analyzer"));
        assert!(c.servers.iter().any(|s| s.id == "tsserver"));
    }

    #[test]
    fn load_from_missing_file_returns_defaults() {
        let p = std::path::PathBuf::from("/nonexistent/lsp.toml");
        let c = LspConfig::load(&p).unwrap();
        assert_eq!(c, LspConfig::defaults());
    }

    #[test]
    fn save_then_load_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("lsp.toml");
        let c = LspConfig {
            servers: vec![ServerConfig {
                id: "ruff".into(),
                command: "ruff".into(),
                args: vec!["server".into()],
                languages: vec!["python".into()],
                initialization_options: None,
            }],
        };
        c.save(&path).unwrap();
        let loaded = LspConfig::load(&path).unwrap();
        assert_eq!(loaded, c);
    }

    #[test]
    fn for_language_filters_correctly() {
        let c = LspConfig::defaults();
        let ts = c.for_language("typescript");
        assert_eq!(ts.len(), 1);
        assert_eq!(ts[0].id, "tsserver");
        let py = c.for_language("python");
        assert_eq!(py.len(), 1);
        assert_eq!(py[0].id, "pyright");
        let none = c.for_language("brainfuck");
        assert!(none.is_empty());
    }

    #[test]
    fn parses_multi_server_per_language() {
        let raw = r#"
[[servers]]
id = "tsserver"
command = "typescript-language-server"
args = ["--stdio"]
languages = ["typescript", "javascript"]

[[servers]]
id = "eslint"
command = "vscode-eslint-language-server"
args = ["--stdio"]
languages = ["typescript", "javascript"]
"#;
        let c: LspConfig = toml::from_str(raw).unwrap();
        let ts = c.for_language("typescript");
        assert_eq!(ts.len(), 2);
    }
}
