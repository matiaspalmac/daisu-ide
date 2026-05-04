//! `propose_edit` tool — produce a hunk-by-hunk edit proposal without
//! touching disk. The Tauri layer (`daisu-app`) owns the in-memory map
//! of pending proposals and the eventual `write_file` apply path; this
//! module only computes the structured diff payload.
//!
//! Hunks are derived from `similar::TextDiff` line-grouped operations
//! so the UI can render Accept / Reject per hunk (Phase 3.1 wires this
//! into Monaco view-zones; the scaffold uses a Radix Dialog overlay).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};

/// A single accept-or-reject unit in an edit proposal.
///
/// Line ranges are 0-based, half-open: `[start, end)`. Empty side means
/// pure insertion (old) or pure deletion (new).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditHunk {
    pub start_old: usize,
    pub end_old: usize,
    pub start_new: usize,
    pub end_new: usize,
    pub old_lines: Vec<String>,
    pub new_lines: Vec<String>,
}

/// A pending edit proposal: original + replacement text plus the
/// computed hunks. The Tauri layer wraps this with a `proposal_id` and
/// stores it on `AppState` until accepted or rejected.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeEdit {
    pub path: PathBuf,
    pub old_text: String,
    pub new_text: String,
    pub hunks: Vec<EditHunk>,
}

impl ProposeEdit {
    #[must_use]
    pub fn new(path: PathBuf, old_text: String, new_text: String) -> Self {
        let hunks = compute_hunks(&old_text, &new_text);
        Self {
            path,
            old_text,
            new_text,
            hunks,
        }
    }
}

/// Compute hunks between `old` and `new`. Each contiguous group of
/// non-equal changes becomes one hunk. Equal runs separate hunks.
#[must_use]
pub fn compute_hunks(old: &str, new: &str) -> Vec<EditHunk> {
    let diff = TextDiff::from_lines(old, new);

    let mut hunks: Vec<EditHunk> = Vec::new();
    let mut current: Option<EditHunk> = None;
    let mut old_idx: usize = 0;
    let mut new_idx: usize = 0;

    for change in diff.iter_all_changes() {
        let value = strip_trailing_newline(change.value());
        match change.tag() {
            ChangeTag::Equal => {
                if let Some(hunk) = current.take() {
                    hunks.push(hunk);
                }
                old_idx += 1;
                new_idx += 1;
            }
            ChangeTag::Delete => {
                let hunk = current.get_or_insert_with(|| EditHunk {
                    start_old: old_idx,
                    end_old: old_idx,
                    start_new: new_idx,
                    end_new: new_idx,
                    old_lines: Vec::new(),
                    new_lines: Vec::new(),
                });
                hunk.old_lines.push(value.to_string());
                hunk.end_old = old_idx + 1;
                old_idx += 1;
            }
            ChangeTag::Insert => {
                let hunk = current.get_or_insert_with(|| EditHunk {
                    start_old: old_idx,
                    end_old: old_idx,
                    start_new: new_idx,
                    end_new: new_idx,
                    old_lines: Vec::new(),
                    new_lines: Vec::new(),
                });
                hunk.new_lines.push(value.to_string());
                hunk.end_new = new_idx + 1;
                new_idx += 1;
            }
        }
    }
    if let Some(hunk) = current.take() {
        hunks.push(hunk);
    }
    hunks
}

fn strip_trailing_newline(s: &str) -> &str {
    s.strip_suffix('\n')
        .map_or(s, |t| t.strip_suffix('\r').unwrap_or(t))
}

/// Build the final file content from the original + only the hunks the
/// user accepted. Rejected hunks fall back to the old text. Indices
/// outside `0..hunks.len()` are silently ignored.
#[must_use]
pub fn apply_accepted_hunks(old_text: &str, hunks: &[EditHunk], accepted: &[usize]) -> String {
    let old_lines: Vec<&str> = old_text.split_inclusive('\n').collect();
    let mut accepted_set: Vec<bool> = vec![false; hunks.len()];
    for &idx in accepted {
        if idx < accepted_set.len() {
            accepted_set[idx] = true;
        }
    }

    let mut out = String::with_capacity(old_text.len());
    let mut cursor: usize = 0;

    for (i, hunk) in hunks.iter().enumerate() {
        // Emit unchanged old lines up to this hunk.
        while cursor < hunk.start_old && cursor < old_lines.len() {
            out.push_str(old_lines[cursor]);
            cursor += 1;
        }
        if accepted_set[i] {
            // Emit the new side of the hunk.
            for (j, line) in hunk.new_lines.iter().enumerate() {
                out.push_str(line);
                let is_last = j + 1 == hunk.new_lines.len();
                let needs_newline = !is_last
                    || hunk.end_new < total_new_lines(hunks, old_text)
                    || old_text.ends_with('\n');
                if needs_newline && !line.ends_with('\n') {
                    out.push('\n');
                }
            }
        } else {
            // Keep the old side verbatim.
            let end = hunk.end_old.min(old_lines.len());
            for line in old_lines.iter().take(end).skip(hunk.start_old) {
                out.push_str(line);
            }
        }
        cursor = hunk.end_old;
    }
    while cursor < old_lines.len() {
        out.push_str(old_lines[cursor]);
        cursor += 1;
    }
    out
}

fn total_new_lines(hunks: &[EditHunk], _old_text: &str) -> usize {
    hunks.last().map_or(0, |h| h.end_new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equal_strings_have_no_hunks() {
        let h = compute_hunks("a\nb\nc\n", "a\nb\nc\n");
        assert!(h.is_empty());
    }

    #[test]
    fn pure_insertion_one_hunk() {
        let h = compute_hunks("a\nb\n", "a\nx\nb\n");
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].old_lines.len(), 0);
        assert_eq!(h[0].new_lines, vec!["x".to_string()]);
    }

    #[test]
    fn pure_deletion_one_hunk() {
        let h = compute_hunks("a\nb\nc\n", "a\nc\n");
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].old_lines, vec!["b".to_string()]);
        assert!(h[0].new_lines.is_empty());
    }

    #[test]
    fn replacement_one_hunk_with_both_sides() {
        let h = compute_hunks("a\nold\nc\n", "a\nnew\nc\n");
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].old_lines, vec!["old".to_string()]);
        assert_eq!(h[0].new_lines, vec!["new".to_string()]);
    }

    #[test]
    fn apply_accepts_selected_hunks_only() {
        let old = "a\nb\nc\nd\n";
        let new = "a\nB\nc\nD\n";
        let hunks = compute_hunks(old, new);
        assert_eq!(hunks.len(), 2);
        let result = apply_accepted_hunks(old, &hunks, &[0]);
        assert_eq!(result, "a\nB\nc\nd\n");
        let result_none = apply_accepted_hunks(old, &hunks, &[]);
        assert_eq!(result_none, old);
        let result_all = apply_accepted_hunks(old, &hunks, &[0, 1]);
        assert_eq!(result_all, new);
    }
}
