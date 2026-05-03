//! Tauri command surface for the git overlay subsystem.

use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::git::{
    branch::{checkout_branch, fetch_remote, list_branches},
    repo_handle::get_repo,
    status::workspace_status,
    BranchInfo, FetchResult, GitWorkspaceInfo,
};

/// Aggregate command: returns branch + ahead/behind + statuses in one round
/// trip for the frontend's initial render.
///
/// # Errors
/// Returns [`AppError::Internal`] if the workspace is not a git repository
/// or if git2 enumeration fails.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub async fn git_workspace_info(workspace_path: String) -> AppResult<GitWorkspaceInfo> {
    let path = Path::new(&workspace_path).to_path_buf();
    tokio::task::spawn_blocking(move || -> AppResult<GitWorkspaceInfo> {
        let handle = get_repo(&path)?;
        let repo = handle.lock();
        let head = repo
            .head()
            .map_err(|e| AppError::Internal(format!("git head: {e}")))?;
        let branch = head.shorthand().unwrap_or("HEAD").to_string();
        drop(head);
        let (ahead, behind) = compute_ahead_behind(&repo, &branch);
        let remote_url = repo
            .find_remote("origin")
            .ok()
            .and_then(|r| r.url().map(String::from));
        let statuses = workspace_status(&repo)?;
        Ok(GitWorkspaceInfo {
            branch,
            ahead,
            behind,
            remote_url,
            statuses,
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("join: {e}")))?
}

#[allow(clippy::cast_possible_truncation)]
fn compute_ahead_behind(repo: &git2::Repository, local_branch: &str) -> (u32, u32) {
    let upstream_name = format!("origin/{local_branch}");
    let Ok(local_oid) = repo.refname_to_id(&format!("refs/heads/{local_branch}")) else {
        return (0, 0);
    };
    let Ok(upstream_oid) = repo.refname_to_id(&format!("refs/remotes/{upstream_name}")) else {
        return (0, 0);
    };
    repo.graph_ahead_behind(local_oid, upstream_oid)
        .map_or((0, 0), |(a, b)| {
            (
                u32::try_from(a).unwrap_or(u32::MAX),
                u32::try_from(b).unwrap_or(u32::MAX),
            )
        })
}

/// List local + remote branches.
///
/// # Errors
/// Propagates errors from [`get_repo`] or [`list_branches`].
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub async fn git_list_branches(workspace_path: String) -> AppResult<Vec<BranchInfo>> {
    let path = Path::new(&workspace_path).to_path_buf();
    tokio::task::spawn_blocking(move || -> AppResult<Vec<BranchInfo>> {
        let handle = get_repo(&path)?;
        let repo = handle.lock();
        list_branches(&repo)
    })
    .await
    .map_err(|e| AppError::Internal(format!("join: {e}")))?
}

/// Checkout `branch`. `force = true` discards uncommitted changes.
///
/// # Errors
/// Propagates errors from [`get_repo`] or [`checkout_branch`].
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub async fn git_checkout_branch(
    workspace_path: String,
    branch: String,
    force: bool,
) -> AppResult<()> {
    let path = Path::new(&workspace_path).to_path_buf();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let handle = get_repo(&path)?;
        let repo = handle.lock();
        checkout_branch(&repo, &branch, force)
    })
    .await
    .map_err(|e| AppError::Internal(format!("join: {e}")))?
}

/// Fetch from `remote`. Returns the new commit count delta.
///
/// # Errors
/// Propagates errors from [`get_repo`] or [`fetch_remote`].
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub async fn git_fetch_remote(workspace_path: String, remote: String) -> AppResult<FetchResult> {
    let path = Path::new(&workspace_path).to_path_buf();
    tokio::task::spawn_blocking(move || -> AppResult<FetchResult> {
        let handle = get_repo(&path)?;
        let repo = handle.lock();
        fetch_remote(&repo, &remote)
    })
    .await
    .map_err(|e| AppError::Internal(format!("join: {e}")))?
}
