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
pub const IGNORE_NAMES: &[&str] = &[
    "target",
    "node_modules",
    "dist",
    ".git",
    ".next",
    ".turbo",
    ".cache",
    "build",
    "out",
    ".vite",
    ".parcel-cache",
    ".nuxt",
    "coverage",
    ".nyc_output",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".pytest_cache",
    ".mypy_cache",
    ".idea",
    ".vscode",
    ".gradle",
    ".mvn",
];

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

//
// ── Watcher ────────────────────────────────────────────────────────────
//

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

/// Handle returned from [`spawn_workspace_watcher`]. Dropping it cancels the
/// watchers (the underlying `notify::Watcher` instances are dropped).
pub struct WatchHandle {
    _workspace: RecommendedWatcher,
    _git_index: Option<RecommendedWatcher>,
}

/// Spawn the workspace + `.git/index` watchers.
///
/// Events are debounced per path over `debounce_window`, then forwarded as a
/// `Vec<String>` over `fs_out`. Any event on `<root>/.git/index` (existing or
/// not at start) emits a tick on `git_out`.
///
/// `cancel` is observed by the dispatcher loop; once cancelled the spawned
/// task exits and the channels close.
///
/// # Errors
/// Returns [`AppError::WatcherError`] if `notify` fails to construct or watch.
#[allow(clippy::needless_pass_by_value)]
pub fn spawn_workspace_watcher(
    root: PathBuf,
    fs_out: Sender<Vec<String>>,
    git_out: Sender<()>,
    cancel: CancellationToken,
    debounce_window: Duration,
) -> AppResult<WatchHandle> {
    let pending: Arc<Mutex<HashMap<PathBuf, Instant>>> = Arc::new(Mutex::new(HashMap::new()));

    let pending_for_ws = Arc::clone(&pending);
    let root_for_ws = root.clone();
    let mut ws_watcher: RecommendedWatcher =
        notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                let interesting = matches!(
                    event.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                );
                if !interesting {
                    return;
                }
                let Ok(mut guard) = pending_for_ws.lock() else {
                    return;
                };
                let now = Instant::now();
                for p in event.paths {
                    if is_ignored(&p, &root_for_ws) {
                        continue;
                    }
                    guard.insert(p, now);
                }
            }
        })
        .map_err(|e| AppError::watcher(format!("create workspace watcher: {e}")))?;

    ws_watcher
        .configure(Config::default())
        .map_err(|e| AppError::watcher(format!("configure watcher: {e}")))?;
    ws_watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| AppError::watcher(format!("watch root: {e}")))?;

    let git_index = root.join(".git/index");
    let git_watcher = if git_index.exists() {
        let git_out_for_cb = git_out.clone();
        let mut g: RecommendedWatcher =
            notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                if res.is_ok() {
                    let _ = git_out_for_cb.try_send(());
                }
            })
            .map_err(|e| AppError::watcher(format!("create git watcher: {e}")))?;
        g.watch(&git_index, RecursiveMode::NonRecursive)
            .map_err(|e| AppError::watcher(format!("watch .git/index: {e}")))?;
        Some(g)
    } else {
        None
    };

    let pending_for_loop = Arc::clone(&pending);
    let cancel_for_loop = cancel.clone();
    tauri::async_runtime::spawn(async move {
        let tick = Duration::from_millis(50);
        loop {
            if cancel_for_loop.is_cancelled() {
                return;
            }
            tokio::time::sleep(tick).await;
            let now = Instant::now();
            let drained: Vec<PathBuf> = {
                let Ok(mut guard) = pending_for_loop.lock() else {
                    return;
                };
                let due: Vec<PathBuf> = guard
                    .iter()
                    .filter(|(_, t)| now.duration_since(**t) >= debounce_window)
                    .map(|(p, _)| p.clone())
                    .collect();
                for p in &due {
                    guard.remove(p);
                }
                due
            };
            if !drained.is_empty() {
                let paths: Vec<String> = drained
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if fs_out.send(paths).await.is_err() {
                    return;
                }
            }
        }
    });

    Ok(WatchHandle {
        _workspace: ws_watcher,
        _git_index: git_watcher,
    })
}
