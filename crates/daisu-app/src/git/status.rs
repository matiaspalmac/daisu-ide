//! Map `git2` status flags to the four-status enum the frontend renders.
//! Precedence: Conflict > Staged > Untracked > Modified.

use std::collections::HashMap;

use git2::{Repository, Status, StatusOptions};

use crate::error::{AppError, AppResult};

use super::GitFileStatus;

/// Walk the repo's working tree + index and collapse statuses into the
/// 4-variant enum.
///
/// # Errors
/// Returns [`AppError::Internal`] if `git2::Repository::statuses` fails.
pub fn workspace_status(repo: &Repository) -> AppResult<HashMap<String, GitFileStatus>> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| AppError::Internal(format!("git statuses: {e}")))?;

    let mut map: HashMap<String, GitFileStatus> = HashMap::new();
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        if path.is_empty() {
            continue;
        }
        let s = entry.status();
        let kind = if s.contains(Status::CONFLICTED) {
            GitFileStatus::Conflict
        } else if s.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        ) {
            GitFileStatus::Staged
        } else if s.intersects(Status::WT_NEW) {
            GitFileStatus::Untracked
        } else if s.intersects(
            Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_TYPECHANGE | Status::WT_RENAMED,
        ) {
            GitFileStatus::Modified
        } else {
            continue;
        };
        map.insert(path, kind);
    }

    Ok(map)
}
