use std::time::Duration;

use daisu_app::watch::git_watcher::watch_git_dir;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn watcher_emits_on_index_change() {
    let tmp = tempfile::tempdir().unwrap();
    let git_dir = tmp.path().join(".git");
    std::fs::create_dir_all(&git_dir).unwrap();
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    std::fs::write(git_dir.join("index"), b"v1").unwrap();

    let (tx, mut rx) = mpsc::channel::<()>(8);
    let cancel = CancellationToken::new();
    let _handle = watch_git_dir(&git_dir, tx, &cancel, Duration::from_millis(150)).unwrap();

    tokio::time::sleep(Duration::from_millis(300)).await;
    std::fs::write(git_dir.join("index"), b"v2").unwrap();

    let result = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await;
    assert!(matches!(result, Ok(Some(()))));
    cancel.cancel();
}

#[tokio::test]
async fn watcher_emits_on_head_change() {
    let tmp = tempfile::tempdir().unwrap();
    let git_dir = tmp.path().join(".git");
    std::fs::create_dir_all(&git_dir).unwrap();
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    std::fs::write(git_dir.join("index"), b"v1").unwrap();

    let (tx, mut rx) = mpsc::channel::<()>(8);
    let cancel = CancellationToken::new();
    let _handle = watch_git_dir(&git_dir, tx, &cancel, Duration::from_millis(150)).unwrap();

    tokio::time::sleep(Duration::from_millis(300)).await;
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/feature\n").unwrap();

    let result = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await;
    assert!(matches!(result, Ok(Some(()))));
    cancel.cancel();
}

#[tokio::test]
async fn watcher_ignores_unrelated_git_files() {
    let tmp = tempfile::tempdir().unwrap();
    let git_dir = tmp.path().join(".git");
    std::fs::create_dir_all(&git_dir).unwrap();
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    std::fs::write(git_dir.join("index"), b"v1").unwrap();

    let (tx, mut rx) = mpsc::channel::<()>(8);
    let cancel = CancellationToken::new();
    let _handle = watch_git_dir(&git_dir, tx, &cancel, Duration::from_millis(150)).unwrap();

    tokio::time::sleep(Duration::from_millis(300)).await;
    std::fs::write(git_dir.join("config"), "[core]").unwrap();

    let result = tokio::time::timeout(Duration::from_millis(800), rx.recv()).await;
    assert!(result.is_err(), "should NOT have emitted for config change");
    cancel.cancel();
}
