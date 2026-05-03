use std::path::Path;
use std::process::Command;

use daisu_app::git::repo_handle::{get_repo, invalidate};
use daisu_app::git::status::workspace_status;
use daisu_app::git::GitFileStatus;

fn run_git(repo: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(repo)
        .status()
        .expect("git command failed to run");
    assert!(status.success(), "git {args:?} failed");
}

fn init_repo() -> tempfile::TempDir {
    let tmp = tempfile::tempdir().unwrap();
    run_git(tmp.path(), &["init", "-b", "main"]);
    run_git(tmp.path(), &["config", "user.email", "test@example.com"]);
    run_git(tmp.path(), &["config", "user.name", "Test"]);
    std::fs::write(tmp.path().join("README.md"), "hello\n").unwrap();
    run_git(tmp.path(), &["add", "."]);
    run_git(tmp.path(), &["commit", "-m", "init"]);
    tmp
}

#[test]
fn workspace_info_returns_branch_and_status_modified() {
    let tmp = init_repo();
    std::fs::write(tmp.path().join("README.md"), "modified\n").unwrap();
    let handle = get_repo(tmp.path()).unwrap();
    let repo = handle.lock();
    let statuses = workspace_status(&repo).unwrap();
    let entry = statuses.get("README.md").expect("README.md present");
    assert!(matches!(entry, GitFileStatus::Modified));
    drop(repo);
    invalidate(tmp.path());
}

#[test]
fn status_reports_untracked_files() {
    let tmp = init_repo();
    std::fs::write(tmp.path().join("new.txt"), "fresh\n").unwrap();
    let handle = get_repo(tmp.path()).unwrap();
    let repo = handle.lock();
    let statuses = workspace_status(&repo).unwrap();
    assert!(matches!(
        statuses.get("new.txt"),
        Some(GitFileStatus::Untracked)
    ));
    drop(repo);
    invalidate(tmp.path());
}

#[test]
fn status_reports_staged_changes() {
    let tmp = init_repo();
    std::fs::write(tmp.path().join("staged.txt"), "queued\n").unwrap();
    run_git(tmp.path(), &["add", "staged.txt"]);
    let handle = get_repo(tmp.path()).unwrap();
    let repo = handle.lock();
    let statuses = workspace_status(&repo).unwrap();
    assert!(matches!(
        statuses.get("staged.txt"),
        Some(GitFileStatus::Staged)
    ));
    drop(repo);
    invalidate(tmp.path());
}

#[test]
fn status_conflict_takes_precedence() {
    let tmp = init_repo();
    let handle = get_repo(tmp.path()).unwrap();
    let repo = handle.lock();
    let _ = workspace_status(&repo).unwrap();
    drop(repo);
    invalidate(tmp.path());
}
