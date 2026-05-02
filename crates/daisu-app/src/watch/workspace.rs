//! Workspace walker and watchers. Phase 2 owns three tokio tasks per open
//! workspace: a walker, a recursive workspace watcher, and a `.git/index`
//! watcher. The walker streams [`TreeBatch`] values; the watchers stream
//! debounced fs-change paths.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tokio::sync::mpsc::Sender;
use tokio_util::sync::CancellationToken;

use crate::commands::file_ops::{FileEntry, FileKind};
use crate::error::{AppError, AppResult};

/// Names skipped at any depth during walks. Mirrors the `IGNORE_NAMES` constant
/// in `commands/file_ops.rs`. Phase 4 surfaces this as a user setting.
pub const IGNORE_NAMES: &[&str] = &["target", "node_modules", "dist", ".git"];

/// Subdir under the workspace root that we skip explicitly (session restore).
pub const SESSIONS_DIR: &str = ".daisu/sessions";

/// Configuration passed to [`walk_workspace`].
#[derive(Debug, Clone)]
pub struct WalkOptions {
    pub batch_size: usize,
    pub batch_flush_after: Duration,
}

impl Default for WalkOptions {
    fn default() -> Self {
        Self {
            batch_size: 200,
            batch_flush_after: Duration::from_millis(50),
        }
    }
}

/// One batch of nodes streamed from the walker to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TreeBatch {
    pub batch_id: String,
    pub parent_path: Option<String>,
    pub nodes: Vec<FileEntry>,
    pub done: bool,
    pub error: Option<String>,
}

/// Walk the workspace under `root` recursively, streaming [`TreeBatch`] values
/// over `out`. The walk cancels promptly when `token` is cancelled.
///
/// # Errors
/// Returns [`AppError::Cancelled`] if the token is cancelled mid-walk, or
/// [`AppError::Internal`] if the blocking task panics.
#[allow(clippy::needless_pass_by_value)]
pub async fn walk_workspace(
    root: PathBuf,
    opts: WalkOptions,
    batch_id: String,
    token: CancellationToken,
    out: Sender<TreeBatch>,
) -> AppResult<()> {
    let token_for_blocking = token.clone();
    tokio::task::spawn_blocking(move || {
        run_walk_blocking(root, opts, batch_id, token_for_blocking, out)
    })
    .await
    .map_err(|e| AppError::Internal(format!("walker join: {e}")))?
}

#[allow(clippy::needless_pass_by_value)]
fn run_walk_blocking(
    root: PathBuf,
    opts: WalkOptions,
    batch_id: String,
    token: CancellationToken,
    out: Sender<TreeBatch>,
) -> AppResult<()> {
    use walkdir::WalkDir;

    let mut buf: Vec<FileEntry> = Vec::with_capacity(opts.batch_size);
    let mut last_flush = Instant::now();

    let walker = WalkDir::new(&root)
        .follow_links(false)
        .same_file_system(true)
        .into_iter()
        .filter_entry(|e| !is_ignored(e.path(), &root));

    for entry in walker {
        if token.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        let Ok(entry) = entry else {
            continue;
        };
        if entry.path() == root.as_path() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let kind = if metadata.is_dir() {
            FileKind::Dir
        } else {
            FileKind::File
        };
        let size = metadata.is_file().then_some(metadata.len());
        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
        let path_str = entry.path().to_string_lossy().into_owned();
        let name = entry.file_name().to_string_lossy().into_owned();
        buf.push(FileEntry {
            path: path_str,
            name,
            kind,
            size,
            mtime_ms,
        });

        if buf.len() >= opts.batch_size || last_flush.elapsed() >= opts.batch_flush_after {
            let batch = TreeBatch {
                batch_id: batch_id.clone(),
                parent_path: None,
                nodes: std::mem::take(&mut buf),
                done: false,
                error: None,
            };
            if blocking_send(&out, batch).is_err() {
                return Err(AppError::Cancelled);
            }
            last_flush = Instant::now();
        }
    }

    let final_batch = TreeBatch {
        batch_id,
        parent_path: None,
        nodes: buf,
        done: true,
        error: None,
    };
    let _ = blocking_send(&out, final_batch);
    Ok(())
}

fn blocking_send(out: &Sender<TreeBatch>, batch: TreeBatch) -> Result<(), ()> {
    out.blocking_send(batch).map_err(|_| ())
}

/// Returns true when `path` should be filtered from walks/watchers per
/// the workspace-wide ignore list (or the `.daisu/sessions` carve-out).
#[must_use]
pub fn is_ignored(path: &Path, root: &Path) -> bool {
    if let Ok(rel) = path.strip_prefix(root) {
        let rel_str = rel.to_string_lossy();
        if rel_str.starts_with(SESSIONS_DIR) {
            return true;
        }
    }
    for component in path.components() {
        if let std::path::Component::Normal(s) = component {
            if let Some(name) = s.to_str() {
                if IGNORE_NAMES.contains(&name) {
                    return true;
                }
            }
        }
    }
    false
}
