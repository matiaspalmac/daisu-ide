//! Branch listing, checkout, and fetch operations on top of `git2`.

use git2::build::CheckoutBuilder;
use git2::{BranchType, FetchOptions, RemoteCallbacks, Repository, Status, StatusOptions};

use crate::error::{AppError, AppResult};

use super::{BranchInfo, FetchResult};

fn workdir_is_dirty(repo: &Repository) -> bool {
    let mut opts = StatusOptions::new();
    opts.include_untracked(false).include_ignored(false);
    let Ok(statuses) = repo.statuses(Some(&mut opts)) else {
        return false;
    };
    statuses.iter().any(|e| {
        let s = e.status();
        s.intersects(
            Status::WT_MODIFIED
                | Status::WT_DELETED
                | Status::WT_TYPECHANGE
                | Status::WT_RENAMED
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE
                | Status::INDEX_NEW,
        )
    })
}

/// List local + remote branches with HEAD marked.
///
/// # Errors
/// Returns [`AppError::Internal`] if `git2` fails to enumerate branches.
pub fn list_branches(repo: &Repository) -> AppResult<Vec<BranchInfo>> {
    let head_short = repo
        .head()
        .ok()
        .and_then(|r| r.shorthand().map(String::from));

    let mut out: Vec<BranchInfo> = Vec::new();

    for br in repo
        .branches(Some(BranchType::Local))
        .map_err(|e| AppError::Internal(format!("git branches local: {e}")))?
    {
        let (b, _) = br.map_err(|e| AppError::Internal(format!("branch entry: {e}")))?;
        let name = b
            .name()
            .map_err(|e| AppError::Internal(format!("branch name: {e}")))?
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        out.push(BranchInfo {
            is_head: head_short.as_deref() == Some(name.as_str()),
            name,
            is_remote: false,
        });
    }

    for br in repo
        .branches(Some(BranchType::Remote))
        .map_err(|e| AppError::Internal(format!("git branches remote: {e}")))?
    {
        let (b, _) = br.map_err(|e| AppError::Internal(format!("branch entry: {e}")))?;
        let name = b
            .name()
            .map_err(|e| AppError::Internal(format!("branch name: {e}")))?
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        out.push(BranchInfo {
            name,
            is_remote: true,
            is_head: false,
        });
    }

    Ok(out)
}

/// Checkout `branch_name`. `force = true` discards local changes.
///
/// # Errors
/// Returns [`AppError::Internal`] if the branch cannot be resolved or the
/// working tree is dirty when `force == false`.
pub fn checkout_branch(repo: &Repository, branch_name: &str, force: bool) -> AppResult<()> {
    if !force && workdir_is_dirty(repo) {
        return Err(AppError::Internal(
            "working tree is dirty; use force to override".to_string(),
        ));
    }

    let (object, reference) = repo
        .revparse_ext(branch_name)
        .map_err(|e| AppError::Internal(format!("revparse {branch_name}: {e}")))?;

    let mut builder = CheckoutBuilder::new();
    if force {
        builder.force();
    } else {
        builder.safe();
    }

    repo.checkout_tree(&object, Some(&mut builder))
        .map_err(|e| AppError::Internal(format!("checkout_tree: {e}")))?;

    if let Some(r) = reference {
        let ref_name = r
            .name()
            .ok_or_else(|| AppError::Internal("invalid ref".to_string()))?;
        repo.set_head(ref_name)
            .map_err(|e| AppError::Internal(format!("set_head: {e}")))?;
    } else {
        repo.set_head_detached(object.id())
            .map_err(|e| AppError::Internal(format!("set_head_detached: {e}")))?;
    }
    Ok(())
}

/// Fetch from `remote`. Returns the count of new commits received.
///
/// # Errors
/// Returns [`AppError::Internal`] if the remote cannot be looked up or the
/// fetch operation fails.
pub fn fetch_remote(repo: &Repository, remote_name: &str) -> AppResult<FetchResult> {
    let mut remote = repo
        .find_remote(remote_name)
        .map_err(|e| AppError::Internal(format!("find_remote {remote_name}: {e}")))?;
    let mut fetch_opts = FetchOptions::new();
    let callbacks = RemoteCallbacks::new();
    fetch_opts.remote_callbacks(callbacks);

    let before = remote_head_count(repo, remote_name);
    remote
        .fetch::<&str>(&[], Some(&mut fetch_opts), None)
        .map_err(|e| AppError::Internal(format!("fetch: {e}")))?;
    let after = remote_head_count(repo, remote_name);
    let commits_received = after.saturating_sub(before);

    Ok(FetchResult {
        commits_received,
        remote: remote_name.to_string(),
    })
}

fn remote_head_count(repo: &Repository, remote_name: &str) -> u32 {
    let prefix = format!("{remote_name}/");
    repo.branches(Some(BranchType::Remote))
        .ok()
        .map_or(0u32, |iter| {
            u32::try_from(
                iter.filter_map(Result::ok)
                    .filter(|(b, _)| {
                        b.name()
                            .ok()
                            .flatten()
                            .is_some_and(|n| n.starts_with(&prefix))
                    })
                    .count(),
            )
            .unwrap_or(u32::MAX)
        })
}
