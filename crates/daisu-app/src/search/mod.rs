//! Workspace search subsystem. Phase 5 owns the streaming text search
//! pipeline: ignore-aware walking, regex matching, per-file streaming with
//! cancellation tokens, and atomic bulk-replace.

pub mod matcher;
pub mod registry;
pub mod replacer;
pub mod searcher;
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SearchHit {
    pub id: String,
    pub path: String,
    pub line_no: u32,
    pub line_text: String,
    pub match_start_col: u32,
    pub match_end_col: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SearchSummary {
    pub request_id: String,
    pub total_hits: u32,
    pub files_searched: u32,
    pub truncated: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SearchHitEvent {
    pub request_id: String,
    pub hits: Vec<SearchHit>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SearchProgressEvent {
    pub request_id: String,
    pub files_searched: u32,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ReplaceRequest {
    pub options: SearchOptions,
    pub replacement: String,
    pub hits: Vec<SearchHit>,
    pub excluded_hit_ids: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ReplaceError {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ReplaceResults {
    pub files_modified: u32,
    pub total_replacements: u32,
    pub errors: Vec<ReplaceError>,
}
