//! Workspace search subsystem. Phase 5 owns the streaming text search
//! pipeline: ignore-aware walking, regex matching, per-file streaming with
//! cancellation tokens, and atomic bulk-replace.

pub mod matcher;
pub mod walker;

#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, serde::Deserialize)]
pub struct SearchOptions {
    pub query: String,
    pub case_sensitive: bool,
    pub regex: bool,
    pub whole_word: bool,
    pub multiline: bool,
    pub include_globs: Vec<String>,
    pub exclude_globs: Vec<String>,
    pub max_results: usize,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            query: String::new(),
            case_sensitive: false,
            regex: false,
            whole_word: false,
            multiline: false,
            include_globs: Vec::new(),
            exclude_globs: Vec::new(),
            max_results: 5000,
        }
    }
}
