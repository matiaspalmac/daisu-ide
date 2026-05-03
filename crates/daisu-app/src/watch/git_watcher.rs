//! Watcher that fires once-per-debounce-window when `.git/index` or
//! `.git/HEAD` change. Frontend listens for the resulting `git-changed`
//! Tauri event and refreshes `gitStore`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use tokio::sync::mpsc::Sender;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};

/// Returns a [`RecommendedWatcher`] kept alive by the caller. Spawns an
/// internal debounce loop that emits on `out` at most once per
/// `debounce_window` whenever an `.git/index` or `.git/HEAD` change is
/// detected.
///
/// # Errors
/// Returns [`AppError::WatcherError`] if `notify` fails to construct the
/// watcher or watch the directory. Returns [`AppError::NotFound`] if the
/// `.git` directory does not exist.
pub fn watch_git_dir(
    git_dir: &std::path::Path,
    out: Sender<()>,
    cancel: &CancellationToken,
    debounce_window: Duration,
) -> AppResult<RecommendedWatcher> {
    if !git_dir.exists() {
        return Err(AppError::not_found(git_dir.display().to_string()));
    }

    let pending: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
    let pending_for_cb = Arc::clone(&pending);

    let mut watcher: RecommendedWatcher =
        notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                for path in event.paths {
                    let name = path.file_name().and_then(|s| s.to_str());
                    if matches!(name, Some("index" | "HEAD")) {
                        *pending_for_cb.lock() = Some(Instant::now());
                        return;
                    }
                }
            }
        })
        .map_err(|e| AppError::watcher(format!("git watcher create: {e}")))?;

    watcher
        .watch(git_dir, RecursiveMode::NonRecursive)
        .map_err(|e| AppError::watcher(format!("git watcher watch: {e}")))?;

    let pending_for_loop = Arc::clone(&pending);
    let cancel_for_loop = cancel.clone();
    tauri::async_runtime::spawn(async move {
        let tick = Duration::from_millis(50);
        loop {
            if cancel_for_loop.is_cancelled() {
                return;
            }
            tokio::time::sleep(tick).await;
            let should_emit = {
                let mut pending_lock = pending_for_loop.lock();
                if let Some(t) = *pending_lock {
                    if t.elapsed() >= debounce_window {
                        *pending_lock = None;
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            };
            if should_emit && out.send(()).await.is_err() {
                return;
            }
        }
    });

    Ok(watcher)
}
