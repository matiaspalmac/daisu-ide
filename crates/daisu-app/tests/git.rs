use std::path::Path;
use std::process::Command;

use daisu_app::git::branch::{checkout_branch, list_branches};
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

#[test]
fn list_branches_marks_head_local() {
    let tmp = init_repo();
    let handle = get_repo(tmp.path()).unwrap();
    let repo = handle.lock();
    let branches = list_branches(&repo).unwrap();
    let head = branches.iter().find(|b| b.is_head).unwrap();
    assert_eq!(head.name, "main");
    assert!(!head.is_remote);
    drop(repo);
    invalidate(tmp.path());
}

#[test]
fn checkout_succeeds_on_clean_tree() {
    let tmp = init_repo();
    run_git(tmp.path(), &["checkout", "-b", "feature"]);
    run_git(tmp.path(), &["checkout", "main"]);
    let handle = get_repo(tmp.path()).unwrap();
    let repo = handle.lock();
    checkout_branch(&repo, "feature", false).unwrap();
    let branches = list_branches(&repo).unwrap();
    let head = branches.iter().find(|b| b.is_head).unwrap();
    assert_eq!(head.name, "feature");
    drop(repo);
    invalidate(tmp.path());
}

#[test]
fn checkout_safe_fails_on_dirty_tree() {
    let tmp = init_repo();
    run_git(tmp.path(), &["checkout", "-b", "feature"]);
    run_git(tmp.path(), &["checkout", "main"]);
    std::fs::write(tmp.path().join("README.md"), "dirty\n").unwrap();
    let handle = get_repo(tmp.path()).unwrap();
    let repo = handle.lock();
    let result = checkout_branch(&repo, "feature", false);
    assert!(result.is_err(), "safe checkout must fail on dirty tree");
    drop(repo);
    invalidate(tmp.path());
}

#[test]
fn checkout_force_succeeds_on_dirty_tree() {
    let tmp = init_repo();
    run_git(tmp.path(), &["checkout", "-b", "feature"]);
    run_git(tmp.path(), &["checkout", "main"]);
    std::fs::write(tmp.path().join("README.md"), "dirty\n").unwrap();
    let handle = get_repo(tmp.path()).unwrap();
    let repo = handle.lock();
    checkout_branch(&repo, "feature", true).unwrap();
    let branches = list_branches(&repo).unwrap();
    let head = branches.iter().find(|b| b.is_head).unwrap();
    assert_eq!(head.name, "feature");
    drop(repo);
    invalidate(tmp.path());
}
