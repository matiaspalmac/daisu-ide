//! Regex matcher construction for search queries.
//!
//! Composes literal-vs-regex, case sensitivity, whole-word boundaries, and
//! multiline mode into a single [`grep_regex::RegexMatcher`].

use grep_regex::{RegexMatcher, RegexMatcherBuilder};

use crate::error::{AppError, AppResult};

use super::SearchOptions;

/// Build a regex matcher honoring all four toggles.
///
/// # Errors
/// Returns [`AppError::Internal`] for invalid regex syntax (only when
/// `opts.regex == true`; literal mode escapes the query).
pub fn build_matcher(opts: &SearchOptions) -> AppResult<RegexMatcher> {
    let mut builder = RegexMatcherBuilder::new();
    builder.case_insensitive(!opts.case_sensitive);
    builder.multi_line(opts.multiline);
    builder.dot_matches_new_line(opts.multiline);

    let pattern = if opts.regex {
        opts.query.clone()
    } else {
        regex::escape(&opts.query)
    };
    let pattern = if opts.whole_word {
        format!(r"\b(?:{pattern})\b")
    } else {
        pattern
    };
    builder
        .build(&pattern)
        .map_err(|e| AppError::Internal(format!("regex: {e}")))
}
