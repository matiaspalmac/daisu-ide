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

/// Convert a UTF-8 byte offset within `line` into a UTF-16 code-unit
/// column. Monaco — and every other JS-side consumer — measures
/// columns in UTF-16, so emitting raw byte offsets puts highlights in
/// the wrong place for any line containing non-ASCII characters.
///
/// Used only by tests; the hot path uses `Utf16Cursor` for O(N) line
/// processing instead of O(N²) re-scanning per match.
#[cfg(test)]
#[allow(clippy::cast_possible_truncation)]
fn utf8_byte_to_utf16_col(line: &str, byte_offset: usize) -> u32 {
    let clamped = byte_offset.min(line.len());
    // Walk char boundaries to keep the slice valid even if the regex
    // matched at a non-boundary (it shouldn't with grep, but cheap).
    let safe = (0..=clamped)
        .rev()
        .find(|i| line.is_char_boundary(*i))
        .unwrap_or(0);
    line[..safe].encode_utf16().count() as u32
}

/// Forward-only cursor that converts a *monotonically advancing*
/// sequence of UTF-8 byte offsets into UTF-16 column positions.
///
/// `search_one_file` produces matches in order with `start = abs_end`
/// of the previous match, so we only ever need to walk the line
/// forward. Calling `col_at` on increasing byte offsets visits each
/// `char` at most once across the whole line — O(N) per line vs the
/// O(N²) cost of re-scanning from the start for every match.
struct Utf16Cursor<'a> {
    line: &'a str,
    chars: std::str::Chars<'a>,
    byte_pos: usize,
    utf16_col: u32,
}

impl<'a> Utf16Cursor<'a> {
    fn new(line: &'a str) -> Self {
        Self {
            line,
            chars: line.chars(),
            byte_pos: 0,
            utf16_col: 0,
        }
    }

    /// Advance to `target_byte` (clamped to the line length) and return
    /// the running UTF-16 column count. Caller must invoke this with
    /// non-decreasing `target_byte`; calling with a smaller value is
    /// a logic bug but won't panic — the cursor just stays put and
    /// returns its current column.
    #[allow(clippy::cast_possible_truncation)]
    fn col_at(&mut self, target_byte: usize) -> u32 {
        let target = target_byte.min(self.line.len());
        while self.byte_pos < target {
            match self.chars.next() {
                Some(ch) => {
                    self.byte_pos += ch.len_utf8();
                    self.utf16_col += ch.len_utf16() as u32;
                }
                None => break,
            }
        }
        self.utf16_col
    }
}

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
            // One cursor per line, reused across all matches on that
            // line. Matches are produced in monotonic byte order so
            // the cursor only walks forward — total O(N) per line.
            let mut cursor = Utf16Cursor::new(line);
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
                        let start_col = cursor.col_at(abs_start);
                        let end_col = cursor.col_at(abs_end);
                        buffer.push(SearchHit {
                            id: Uuid::new_v4().to_string(),
                            path: path_str.clone(),
                            line_no: line_no as u32,
                            line_text: line.trim_end_matches(['\r', '\n']).to_string(),
                            match_start_col: start_col,
                            match_end_col: end_col,
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

#[cfg(test)]
mod tests {
    use super::{utf8_byte_to_utf16_col, Utf16Cursor};

    #[test]
    fn ascii_byte_offset_equals_utf16_col() {
        assert_eq!(utf8_byte_to_utf16_col("hello", 0), 0);
        assert_eq!(utf8_byte_to_utf16_col("hello", 5), 5);
    }

    #[test]
    fn multi_byte_utf8_collapses_to_single_utf16_unit() {
        // "é" is 2 bytes in UTF-8, 1 code unit in UTF-16.
        assert_eq!(utf8_byte_to_utf16_col("héllo", 3), 2);
        // "日" is 3 bytes in UTF-8, 1 code unit in UTF-16.
        assert_eq!(utf8_byte_to_utf16_col("日本語", 3), 1);
        assert_eq!(utf8_byte_to_utf16_col("日本語", 9), 3);
    }

    #[test]
    fn surrogate_pair_emoji_takes_two_utf16_units() {
        // "🎌" is 4 bytes in UTF-8, 2 code units in UTF-16 (surrogate pair).
        assert_eq!(utf8_byte_to_utf16_col("🎌x", 4), 2);
        assert_eq!(utf8_byte_to_utf16_col("🎌x", 5), 3);
    }

    #[test]
    fn out_of_range_offset_clamps_to_line_end() {
        assert_eq!(utf8_byte_to_utf16_col("abc", 99), 3);
    }

    #[test]
    fn cursor_handles_monotonic_advancement() {
        // Sequence of byte offsets matching the search hot path:
        // start, end, start, end across the same line.
        let line = "héllo 日本語 🎌 world";
        let mut c = Utf16Cursor::new(line);
        // "é" at byte 1..3 -> utf16 cols 1..2
        assert_eq!(c.col_at(1), 1);
        assert_eq!(c.col_at(3), 2);
        // "日本語" at byte 7..16 -> utf16 cols 6..9
        assert_eq!(c.col_at(7), 6);
        assert_eq!(c.col_at(16), 9);
        // "🎌" at byte 17..21 -> utf16 cols 10..12 (surrogate pair = 2 units)
        assert_eq!(c.col_at(17), 10);
        assert_eq!(c.col_at(21), 12);
    }

    #[test]
    fn cursor_stays_put_on_non_advancing_call() {
        // Defensive check: caller bug shouldn't panic.
        let mut c = Utf16Cursor::new("héllo");
        assert_eq!(c.col_at(3), 2);
        // Calling with a smaller offset should return current position.
        assert_eq!(c.col_at(1), 2);
    }

    #[test]
    fn cursor_matches_helper_for_arbitrary_offsets() {
        // Sanity-check the cursor against the slow but obviously-correct
        // reference implementation across a dense sequence of offsets.
        let line = "abc日本語def🎌xyz";
        let mut c = Utf16Cursor::new(line);
        for byte in 0..=line.len() {
            if line.is_char_boundary(byte) {
                let cursor_col = c.col_at(byte);
                let helper_col = utf8_byte_to_utf16_col(line, byte);
                assert_eq!(cursor_col, helper_col, "mismatch at byte {byte}");
            }
        }
    }
}
