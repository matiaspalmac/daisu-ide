//! Workspace-wide bulk replace. Each file is rewritten atomically: hits
//! identified by the prior search are applied at their exact (line, column)
//! coordinates, then the result is written to a sibling temp file in the
//! same directory and renamed. NTFS rename is atomic on the same volume,
//! so a partial write cannot leave a half-written original.
//!
//! `excluded_hit_ids` is the source of truth for which hits to skip. Hits
//! whose ids appear in the set are removed before per-file rewriting.
//! Per-file errors are collected and returned; one bad file does NOT abort
//! the rest of the replace operation.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

use super::{ReplaceError, ReplaceRequest, ReplaceResults, SearchHit};

/// Inner pure async function for testing. The `replace_in_workspace` Tauri
/// command is a thin wrapper.
///
/// # Errors
/// Returns [`AppError`] if the request shape is invalid. Per-file I/O errors
/// are captured into [`ReplaceResults::errors`] without aborting other files.
pub async fn replace_in_workspace_inner(req: ReplaceRequest) -> AppResult<ReplaceResults> {
    let excluded: HashSet<String> = req.excluded_hit_ids.into_iter().collect();
    let mut by_file: HashMap<String, Vec<SearchHit>> = HashMap::new();
    for hit in req.hits {
        if excluded.contains(&hit.id) {
            continue;
        }
        by_file.entry(hit.path.clone()).or_default().push(hit);
    }

    let mut files_modified: u32 = 0;
    let mut total_replacements: u32 = 0;
    let mut errors: Vec<ReplaceError> = Vec::new();

    for (path_str, hits) in by_file {
        let path = PathBuf::from(&path_str);
        match replace_one_file(&path, &hits, &req.replacement).await {
            Ok(n) if n > 0 => {
                files_modified += 1;
                total_replacements += n;
            }
            Ok(_) => {}
            Err(e) => errors.push(ReplaceError {
                path: path_str,
                reason: e.to_string(),
            }),
        }
    }

    Ok(ReplaceResults {
        files_modified,
        total_replacements,
        errors,
    })
}

#[allow(clippy::cast_possible_truncation)]
async fn replace_one_file(path: &Path, hits: &[SearchHit], replacement: &str) -> AppResult<u32> {
    let bytes = tokio::fs::read(path).await?;
    let text = std::str::from_utf8(&bytes).map_err(|_| AppError::InvalidUtf8)?;

    // Group hits by line number.
    let mut hits_by_line: HashMap<u32, Vec<&SearchHit>> = HashMap::new();
    for h in hits {
        hits_by_line.entry(h.line_no).or_default().push(h);
    }

    // Walk byte ranges line by line, preserving the original separators.
    let mut out = String::with_capacity(text.len());
    let mut applied: u32 = 0;
    let mut current_line: u32 = 1;
    let mut byte_idx = 0;
    while byte_idx < text.len() {
        // Locate the next line terminator (LF). CRLF is handled implicitly:
        // the '\r' becomes part of the line slice if present.
        let line_end = text[byte_idx..]
            .find('\n')
            .map_or(text.len(), |off| byte_idx + off);
        let line_with_separator_end = if line_end < text.len() {
            line_end + 1
        } else {
            line_end
        };
        let line_slice = &text[byte_idx..line_end];

        if let Some(line_hits) = hits_by_line.get(&current_line) {
            // Apply hits right-to-left so column indices remain valid.
            let mut sorted: Vec<&&SearchHit> = line_hits.iter().collect();
            sorted.sort_by_key(|h| std::cmp::Reverse(h.match_start_col));
            let mut buf = line_slice.to_string();
            for h in sorted {
                let start = h.match_start_col as usize;
                let end = h.match_end_col as usize;
                if start <= end && end <= buf.len() {
                    buf.replace_range(start..end, replacement);
                    applied += 1;
                }
            }
            out.push_str(&buf);
        } else {
            out.push_str(line_slice);
        }

        // Preserve the original line separator (LF or CRLF).
        if line_with_separator_end > line_end {
            out.push('\n');
        }
        byte_idx = line_with_separator_end;
        current_line += 1;
    }

    if applied == 0 {
        return Ok(0);
    }

    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path.file_name().map_or_else(
        || "replaced".to_string(),
        |s| s.to_string_lossy().into_owned(),
    );
    let tmp = parent.join(format!(".{file_name}.replace.tmp"));
    tokio::fs::write(&tmp, out.as_bytes()).await?;
    tokio::fs::rename(&tmp, path).await?;
    Ok(applied)
}
