//! Cached `Arc<Mutex<Repository>>` per workspace path. `git2::Repository` is
//! `!Sync` but `Send`; wrapping the handle in a `parking_lot` `Mutex` makes the
//! cache itself `Sync`. Each command acquires the lock for its own
//! thread-local mutation window.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};

use git2::{Repository, RepositoryOpenFlags};
use parking_lot::Mutex;

use crate::error::{AppError, AppResult};

pub type RepoHandle = Arc<Mutex<Repository>>;

static REPO_CACHE: LazyLock<Mutex<HashMap<PathBuf, RepoHandle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Open or fetch a cached repository for `workspace_path`.
///
/// `Repository::open_ext` traverses upward from `workspace_path` to find a
/// `.git` directory (or `.git` file for worktrees), so this also works when
/// the user opened a subdirectory of a repo.
///
/// # Errors
/// Returns [`AppError::Internal`] if the directory is not a git repository
/// or cannot be opened (permissions, corruption, etc.).
pub fn get_repo(workspace_path: &Path) -> AppResult<RepoHandle> {
    let mut cache = REPO_CACHE.lock();
    if let Some(repo) = cache.get(workspace_path) {
        return Ok(Arc::clone(repo));
    }
    let repo = Repository::open_ext(
        workspace_path,
        RepositoryOpenFlags::CROSS_FS,
        Vec::<&Path>::new(),
    )
    .map_err(|e| AppError::Internal(format!("git open: {e}")))?;
    let arc: RepoHandle = Arc::new(Mutex::new(repo));
    cache.insert(workspace_path.to_path_buf(), Arc::clone(&arc));
    Ok(arc)
}

/// Drop the cached handle. Called when a workspace is closed.
pub fn invalidate(workspace_path: &Path) {
    REPO_CACHE.lock().remove(workspace_path);
}

#[cfg(test)]
mod tests {
    use super::{get_repo, invalidate};
    use git2::Repository;
    use std::path::Path;
    use std::sync::Arc;

    fn init_test_repo(path: &Path) {
        Repository::init(path).unwrap();
    }

    #[test]
    fn get_repo_caches_handle() {
        let tmp = tempfile::tempdir().unwrap();
        init_test_repo(tmp.path());
        let a = get_repo(tmp.path()).unwrap();
        let b = get_repo(tmp.path()).unwrap();
        assert!(Arc::ptr_eq(&a, &b));
        invalidate(tmp.path());
    }

    #[test]
    fn invalidate_drops_cache_entry() {
        let tmp = tempfile::tempdir().unwrap();
        init_test_repo(tmp.path());
        let a = get_repo(tmp.path()).unwrap();
        invalidate(tmp.path());
        let b = get_repo(tmp.path()).unwrap();
        assert!(!Arc::ptr_eq(&a, &b));
        invalidate(tmp.path());
    }

    #[test]
    fn get_repo_fails_on_non_git_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let result = get_repo(tmp.path());
        assert!(result.is_err());
    }
}
