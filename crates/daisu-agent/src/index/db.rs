//! SQLite FTS5 backing store for the symbol index.
//!
//! Two tables:
//!   - `symbols_fts` — FTS5 virtual table (name, signature) with the path,
//!     kind, and line range carried as UNINDEXED columns so search hits can
//!     locate the source without a join.
//!   - `symbols_meta` — per-file mtime + content hash for incremental
//!     rebuild detection. The Phase 4 scaffold rebuilds wholesale; the meta
//!     table is wired so a future watch-driven incremental rebuild can skip
//!     untouched files.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AgentError, AgentResult};
use crate::index::parser::Symbol;

const SCHEMA: &str = "
CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
    name,
    signature,
    path UNINDEXED,
    kind UNINDEXED,
    line_start UNINDEXED,
    line_end UNINDEXED
);

CREATE TABLE IF NOT EXISTS symbols_meta (
    path TEXT PRIMARY KEY,
    mtime INTEGER NOT NULL,
    content_hash TEXT NOT NULL
);
";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolHit {
    pub name: String,
    pub kind: String,
    pub path: String,
    pub line_start: u32,
    pub line_end: u32,
    pub signature: Option<String>,
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: impl AsRef<Path>) -> AgentResult<Self> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;\n\
             PRAGMA foreign_keys=ON;\n\
             PRAGMA synchronous=NORMAL;",
        )?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn lock(&self) -> AgentResult<std::sync::MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| AgentError::Internal("index db mutex poisoned".into()))
    }

    pub fn clear_all(&self) -> AgentResult<()> {
        let guard = self.lock()?;
        guard.execute("DELETE FROM symbols_fts", [])?;
        guard.execute("DELETE FROM symbols_meta", [])?;
        Ok(())
    }

    pub fn replace_file(
        &self,
        path: &str,
        mtime: i64,
        content_hash: &str,
        symbols: &[Symbol],
    ) -> AgentResult<()> {
        let mut guard = self.lock()?;
        let tx = guard.transaction()?;
        tx.execute("DELETE FROM symbols_fts WHERE path = ?1", params![path])?;
        tx.execute(
            "INSERT OR REPLACE INTO symbols_meta(path, mtime, content_hash) VALUES (?1, ?2, ?3)",
            params![path, mtime, content_hash],
        )?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO symbols_fts(name, signature, path, kind, line_start, line_end) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?;
            for sym in symbols {
                stmt.execute(params![
                    sym.name,
                    sym.signature,
                    path,
                    sym.kind.as_str(),
                    sym.line_start,
                    sym.line_end,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn search(&self, query: &str, limit: usize) -> AgentResult<Vec<SymbolHit>> {
        let guard = self.lock()?;
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        // Sanitize: drop anything that isn't alphanumeric/underscore so we
        // don't have to worry about FTS5 operator injection. Append `*` to
        // each token for prefix matching.
        let tokens: Vec<String> = trimmed
            .split_whitespace()
            .map(|t| {
                let cleaned: String = t
                    .chars()
                    .filter(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                if cleaned.is_empty() {
                    String::new()
                } else {
                    format!("{cleaned}*")
                }
            })
            .filter(|t| !t.is_empty())
            .collect();
        if tokens.is_empty() {
            return Ok(Vec::new());
        }
        let match_expr = tokens.join(" ");
        // Clamp the limit to a sane positive i64 so a wildly large
        // usize (or future user-controlled value) can't wrap to a
        // negative value when sqlite binds it. 10_000 is well above
        // the palette's usable range and keeps memory bounded.
        let bound_limit: i64 = i64::try_from(limit).unwrap_or(i64::MAX).min(10_000);
        let mut stmt = guard.prepare(
            "SELECT name, kind, path, line_start, line_end, signature \
             FROM symbols_fts WHERE symbols_fts MATCH ?1 \
             ORDER BY rank LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![match_expr, bound_limit], |row| {
                Ok(SymbolHit {
                    name: row.get(0)?,
                    kind: row.get(1)?,
                    path: row.get(2)?,
                    line_start: row.get::<_, i64>(3)? as u32,
                    line_end: row.get::<_, i64>(4)? as u32,
                    signature: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn symbol_count(&self) -> AgentResult<usize> {
        let guard = self.lock()?;
        let n: i64 = guard.query_row("SELECT COUNT(*) FROM symbols_fts", [], |r| r.get(0))?;
        Ok(n as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::parser::SymbolKind;

    #[test]
    fn round_trip_search() {
        let tmp = std::env::temp_dir().join(format!("daisu-index-{}.db", uuid::Uuid::new_v4()));
        let db = Db::open(&tmp).unwrap();
        let symbols = vec![Symbol {
            kind: SymbolKind::Function,
            name: "calculate_total".into(),
            line_start: 10,
            line_end: 20,
            signature: Some("fn calculate_total(items: &[Item]) -> u64".into()),
        }];
        db.replace_file("src/lib.rs", 0, "abc", &symbols).unwrap();
        let hits = db.search("calculate", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "calculate_total");
        let _ = std::fs::remove_file(&tmp);
    }
}
