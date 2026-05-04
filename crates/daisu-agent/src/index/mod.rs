//! Codebase symbol index — M3 Phase 4 scaffold.
//!
//! Tree-sitter parses source files into a normalized [`Symbol`] stream which is
//! persisted into a per-workspace SQLite database (FTS5 virtual table for
//! search + a regular meta table for incremental rebuild detection).
//!
//! Embeddings (sqlite-vec + Ollama nomic-embed) are explicitly deferred from
//! this scaffold and will land in a follow-up.

pub mod db;
pub mod parser;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};

use crate::error::AgentResult;

pub use db::SymbolHit;
pub use parser::{Language, Symbol, SymbolKind};

/// Maximum file size (bytes) the indexer will parse. Files larger than this are
/// skipped — tree-sitter on a multi-megabyte minified blob will dominate the
/// rebuild budget without yielding useful symbols.
pub const MAX_FILE_BYTES: u64 = 1_048_576;

pub struct Indexer {
    workspace: PathBuf,
    db: db::Db,
    last_rebuild: Mutex<Option<i64>>,
}

impl Indexer {
    pub fn new(workspace: impl AsRef<Path>, db_path: impl AsRef<Path>) -> AgentResult<Self> {
        let db = db::Db::open(db_path)?;
        Ok(Self {
            workspace: workspace.as_ref().to_path_buf(),
            db,
            last_rebuild: Mutex::new(None),
        })
    }

    /// Walk the workspace and (re)index every supported source file.
    /// Returns the number of symbols inserted.
    pub fn rebuild(&self) -> AgentResult<usize> {
        let mut total = 0usize;
        self.db.clear_all()?;

        let walker = WalkBuilder::new(&self.workspace)
            .standard_filters(true)
            .hidden(true)
            .build();

        for dent in walker.flatten() {
            let path = dent.path();
            if !path.is_file() {
                continue;
            }
            let Some(lang) = parser::detect_language(path) else {
                continue;
            };
            let Ok(metadata) = std::fs::metadata(path) else {
                continue;
            };
            if metadata.len() > MAX_FILE_BYTES {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(path) else {
                continue;
            };
            let symbols = parser::parse_symbols(lang, &content);
            let mtime = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map_or(0_i64, |d| d.as_secs() as i64);
            let hash = parser::content_hash(&content);
            let rel = path
                .strip_prefix(&self.workspace)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");
            self.db.replace_file(&rel, mtime, &hash, &symbols)?;
            total += symbols.len();
        }

        let now = chrono::Utc::now().timestamp();
        if let Ok(mut guard) = self.last_rebuild.lock() {
            *guard = Some(now);
        }
        Ok(total)
    }

    pub fn search(&self, query: &str, limit: usize) -> AgentResult<Vec<SymbolHit>> {
        self.db.search(query, limit)
    }

    pub fn status(&self) -> AgentResult<IndexStatus> {
        let symbols = self.db.symbol_count()?;
        let last_rebuild = self.last_rebuild.lock().ok().and_then(|g| *g);
        Ok(IndexStatus {
            symbols,
            last_rebuild,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStatus {
    pub symbols: usize,
    pub last_rebuild: Option<i64>,
}
