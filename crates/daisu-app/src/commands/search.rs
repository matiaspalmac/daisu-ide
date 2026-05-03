//! Tauri command surface for workspace search and bulk replace.
//!
//! `search_workspace` walks the workspace via [`crate::search::walker`],
//! streams hits through [`crate::search::searcher::search_one_file`], and
//! emits three kinds of events:
//!
//! - `search-hit` — batched 50 ms with 1..N hits per emit
//! - `search-progress` — every 100 files or 250 ms
//! - `search-done` — final summary when the walk completes naturally
//! - `search-cancelled` — emitted instead of `done` when cancelled mid-walk

use std::path::Path;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::error::AppResult;
use crate::search::{
    matcher::build_matcher, registry, replacer::replace_in_workspace_inner,
    searcher::search_one_file, walker::build_walker, ReplaceRequest, ReplaceResults,
    SearchHitEvent, SearchOptions, SearchProgressEvent, SearchSummary,
};

const PROGRESS_FILE_INTERVAL: u32 = 100;
const PROGRESS_TIME_INTERVAL: Duration = Duration::from_millis(250);

/// Streaming workspace search.
///
/// # Errors
/// Returns [`crate::AppError::Internal`] if the matcher fails to compile.
/// Per-file I/O errors are silently skipped (best-effort streaming).
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn search_workspace(
    app: AppHandle,
    workspace_path: String,
    options: SearchOptions,
    request_id: String,
) -> AppResult<SearchSummary> {
    let token = registry::register(&request_id);
    let matcher = build_matcher(&options)?;
    let walker = build_walker(Path::new(&workspace_path), &options)?;

    let mut files_searched: u32 = 0;
    let mut total_hits: u32 = 0;
    let mut last_progress = Instant::now();
    let mut truncated = false;

    for entry in walker {
        if token.is_cancelled() {
            let _ = app.emit("search-cancelled", &request_id);
            registry::cleanup(&request_id);
            return Ok(SearchSummary {
                request_id,
                total_hits,
                files_searched,
                truncated,
            });
        }
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path = entry.path();
        let app_clone = app.clone();
        let request_id_clone = request_id.clone();
        let outcome = search_one_file(path, &matcher, &token, &options, total_hits, move |hits| {
            let _ = app_clone.emit(
                "search-hit",
                SearchHitEvent {
                    request_id: request_id_clone.clone(),
                    hits,
                },
            );
        });

        // Per-file I/O / permission errors are silently skipped; only Ok updates state.
        if let Ok(out) = outcome {
            total_hits += out.hits_found;
            if out.truncated {
                truncated = true;
                break;
            }
        }

        files_searched += 1;
        if files_searched % PROGRESS_FILE_INTERVAL == 0
            || last_progress.elapsed() > PROGRESS_TIME_INTERVAL
        {
            let _ = app.emit(
                "search-progress",
                SearchProgressEvent {
                    request_id: request_id.clone(),
                    files_searched,
                },
            );
            last_progress = Instant::now();
        }
    }

    let summary = SearchSummary {
        request_id: request_id.clone(),
        total_hits,
        files_searched,
        truncated,
    };
    let _ = app.emit("search-done", &summary);
    registry::cleanup(&request_id);
    Ok(summary)
}

/// Cancel an in-flight search by request id.
///
/// # Errors
/// Currently infallible.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, clippy::unnecessary_wraps)]
pub fn cancel_search(request_id: String) -> AppResult<()> {
    registry::cancel(&request_id);
    Ok(())
}

/// Bulk replace across the supplied hits.
///
/// # Errors
/// Returns [`crate::AppError::Internal`] only if the matcher fails to compile;
/// per-file errors are captured in the returned [`ReplaceResults`].
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub async fn replace_in_workspace(request: ReplaceRequest) -> AppResult<ReplaceResults> {
    replace_in_workspace_inner(request).await
}
