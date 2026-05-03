//! Per-file streaming searcher. Emits hits in batches throttled to 50 ms via
//! the provided emit closure so the frontend doesn't drown in single-hit
//! events on dense matches.

use std::path::Path;
use std::time::{Duration, Instant};

use grep_matcher::Matcher;
use grep_regex::RegexMatcher;
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::{SearchHit, SearchOptions};

const EMIT_THROTTLE: Duration = Duration::from_millis(50);

pub struct FileSearchOutcome {
    pub hits_found: u32,
    pub truncated: bool,
}

/// Search `path` with `matcher`. Buffered hits are flushed via `emit` either
/// when 50 ms elapses since the last flush or when `path` finishes.
///
/// Returns the count of hits found in this file plus a `truncated` flag if the
/// global `total_so_far + opts.max_results` limit was reached mid-file.
///
/// # Errors
/// Returns [`AppError::Internal`] if the searcher I/O fails.
#[allow(clippy::cast_possible_truncation)]
pub fn search_one_file<F>(
    path: &Path,
    matcher: &RegexMatcher,
    token: &CancellationToken,
    opts: &SearchOptions,
    total_so_far: u32,
    mut emit: F,
) -> AppResult<FileSearchOutcome>
where
    F: FnMut(Vec<SearchHit>),
{
    let mut buffer: Vec<SearchHit> = Vec::new();
    let mut last_emit = Instant::now();
    let mut hits_in_file: u32 = 0;
    let mut truncated = false;
    let path_str = path.display().to_string();
    let cap = opts.max_results;

    let mut searcher: Searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\0'))
        .multi_line(opts.multiline)
        .build();

    let result = searcher.search_path(
        matcher,
        path,
        UTF8(|line_no, line| {
            if token.is_cancelled() {
                return Ok(false);
            }
            let bytes = line.as_bytes();
            let mut start = 0usize;
            while start < bytes.len() {
                let m = matcher
                    .find(&bytes[start..])
                    .map_err(|e| std::io::Error::other(format!("matcher: {e}")))?;
                match m {
                    Some(mat) => {
                        let abs_start = start + mat.start();
                        let abs_end = start + mat.end();
                        if abs_end == abs_start {
                            break;
                        }
                        buffer.push(SearchHit {
                            id: Uuid::new_v4().to_string(),
                            path: path_str.clone(),
                            line_no: line_no as u32,
                            line_text: line.trim_end_matches(['\r', '\n']).to_string(),
                            match_start_col: abs_start as u32,
                            match_end_col: abs_end as u32,
                        });
                        hits_in_file += 1;
                        if total_so_far + hits_in_file >= cap as u32 {
                            truncated = true;
                            return Ok(false);
                        }
                        start = abs_end;
                    }
                    None => break,
                }
            }
            if last_emit.elapsed() > EMIT_THROTTLE && !buffer.is_empty() {
                emit(std::mem::take(&mut buffer));
                last_emit = Instant::now();
            }
            Ok(true)
        }),
    );

    match result {
        Ok(()) => {}
        Err(e) => return Err(AppError::Internal(format!("searcher: {e}"))),
    }

    if !buffer.is_empty() {
        emit(buffer);
    }

    Ok(FileSearchOutcome {
        hits_found: hits_in_file,
        truncated,
    })
}
