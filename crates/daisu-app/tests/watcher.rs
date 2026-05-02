use daisu_app::watch::workspace::{spawn_workspace_watcher, WatchHandle};
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn watcher_emits_debounced_paths_on_modify() {
    let tmp = tempfile::tempdir().unwrap();
    let root = PathBuf::from(tmp.path());
    tokio::fs::write(root.join("file.txt"), b"seed")
        .await
        .unwrap();

    let (fs_tx, mut fs_rx) = mpsc::channel(64);
    let (git_tx, _git_rx) = mpsc::channel(8);
    let token = CancellationToken::new();
    let _handle: WatchHandle = spawn_workspace_watcher(
        root.clone(),
        fs_tx,
        git_tx,
        token.clone(),
        Duration::from_millis(150),
    )
    .expect("spawn watcher");

    tokio::time::sleep(Duration::from_millis(200)).await;

    for i in 0..5 {
        tokio::fs::write(root.join("file.txt"), format!("v{i}").as_bytes())
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    let mut got_paths: Vec<String> = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_millis(800);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_millis(200), fs_rx.recv()).await {
            Ok(Some(paths)) => got_paths.extend(paths),
            _ => break,
        }
    }
    assert!(got_paths.iter().any(|p| p.ends_with("file.txt")));
    token.cancel();
}

#[tokio::test]
async fn watcher_filters_ignored_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let root = PathBuf::from(tmp.path());
    tokio::fs::create_dir(root.join("node_modules"))
        .await
        .unwrap();

    let (fs_tx, mut fs_rx) = mpsc::channel(64);
    let (git_tx, _git_rx) = mpsc::channel(8);
    let token = CancellationToken::new();
    let _handle = spawn_workspace_watcher(
        root.clone(),
        fs_tx,
        git_tx,
        token.clone(),
        Duration::from_millis(150),
    )
    .expect("spawn watcher");

    tokio::time::sleep(Duration::from_millis(200)).await;

    tokio::fs::write(root.join("node_modules/x.txt"), b"x")
        .await
        .unwrap();
    let res = tokio::time::timeout(Duration::from_millis(400), fs_rx.recv()).await;
    let none_or_timeout = res.is_err() || matches!(res, Ok(None));
    assert!(none_or_timeout, "expected no event for ignored path");
    token.cancel();
}

#[tokio::test]
async fn watcher_unicode_filenames_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let root = PathBuf::from(tmp.path());
    let names = ["тест.txt", "测试.txt", "テスト.txt"];
    for n in names {
        tokio::fs::write(root.join(n), b"seed").await.unwrap();
    }

    let (fs_tx, mut fs_rx) = mpsc::channel(64);
    let (git_tx, _git_rx) = mpsc::channel(8);
    let token = CancellationToken::new();
    let _handle = spawn_workspace_watcher(
        root.clone(),
        fs_tx,
        git_tx,
        token.clone(),
        Duration::from_millis(120),
    )
    .expect("spawn watcher");

    tokio::time::sleep(Duration::from_millis(200)).await;
    for n in names {
        let mut f = tokio::fs::OpenOptions::new()
            .append(true)
            .open(root.join(n))
            .await
            .unwrap();
        tokio::io::AsyncWriteExt::write_all(&mut f, b"\nmodified")
            .await
            .unwrap();
    }

    let mut seen: Vec<String> = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_millis(1500);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_millis(300), fs_rx.recv()).await {
            Ok(Some(paths)) => seen.extend(paths),
            _ => break,
        }
    }
    for n in names {
        assert!(
            seen.iter().any(|p| p.ends_with(n)),
            "missing event for {n} (saw {seen:?})"
        );
    }
    token.cancel();
}
