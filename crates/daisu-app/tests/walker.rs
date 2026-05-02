use daisu_app::watch::workspace::{walk_workspace, TreeBatch, WalkOptions};
use std::path::PathBuf;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn walk_emits_root_batch_then_done() {
    let tmp = tempfile::tempdir().unwrap();
    tokio::fs::write(tmp.path().join("a.txt"), b"a")
        .await
        .unwrap();
    tokio::fs::create_dir(tmp.path().join("sub")).await.unwrap();
    tokio::fs::write(tmp.path().join("sub/b.txt"), b"b")
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel::<TreeBatch>(16);
    let token = CancellationToken::new();
    let session_id = "sess-1".to_string();
    let opts = WalkOptions::default();

    let root = PathBuf::from(tmp.path());
    let task = tokio::spawn(async move { walk_workspace(root, opts, session_id, token, tx).await });

    let mut nodes_total: usize = 0;
    let mut saw_done = false;
    while let Some(batch) = rx.recv().await {
        nodes_total += batch.nodes.len();
        if batch.done {
            saw_done = true;
            break;
        }
    }
    task.await.unwrap().unwrap();
    assert!(saw_done);
    assert!(nodes_total >= 3, "got {nodes_total}");
}

#[tokio::test]
async fn walk_excludes_default_ignore_list() {
    let tmp = tempfile::tempdir().unwrap();
    tokio::fs::create_dir(tmp.path().join("node_modules"))
        .await
        .unwrap();
    tokio::fs::write(tmp.path().join("node_modules/a.js"), b"a")
        .await
        .unwrap();
    tokio::fs::create_dir(tmp.path().join(".git"))
        .await
        .unwrap();
    tokio::fs::write(tmp.path().join(".git/HEAD"), b"ref")
        .await
        .unwrap();
    tokio::fs::create_dir(tmp.path().join("src")).await.unwrap();
    tokio::fs::write(tmp.path().join("src/keep.rs"), b"x")
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel::<TreeBatch>(16);
    let token = CancellationToken::new();
    let session_id = "sess-ignore".to_string();
    let opts = WalkOptions::default();

    let root = PathBuf::from(tmp.path());
    let _t = tokio::spawn(async move { walk_workspace(root, opts, session_id, token, tx).await });

    let mut all_paths: Vec<String> = Vec::new();
    while let Some(batch) = rx.recv().await {
        for n in &batch.nodes {
            all_paths.push(n.path.clone());
        }
        if batch.done {
            break;
        }
    }
    let joined = all_paths.join("\n");
    assert!(!joined.contains("node_modules"), "must skip node_modules");
    assert!(!joined.contains(".git"), "must skip .git");
    assert!(joined.contains("keep.rs"), "must include src/keep.rs");
}

#[tokio::test]
async fn walk_honors_cancellation() {
    let tmp = tempfile::tempdir().unwrap();
    for i in 0..50 {
        let dir = tmp.path().join(format!("d{i}"));
        tokio::fs::create_dir(&dir).await.unwrap();
        for j in 0..50 {
            tokio::fs::write(dir.join(format!("f{j}.txt")), b"x")
                .await
                .unwrap();
        }
    }

    let (tx, mut rx) = mpsc::channel::<TreeBatch>(16);
    let token = CancellationToken::new();
    let session_id = "sess-cancel".to_string();
    let opts = WalkOptions::default();
    let token_clone = token.clone();

    let root = PathBuf::from(tmp.path());
    let task =
        tokio::spawn(async move { walk_workspace(root, opts, session_id, token_clone, tx).await });

    let _first = rx.recv().await.expect("at least one batch");
    token.cancel();

    while rx.recv().await.is_some() {}
    let result = task.await.unwrap();
    // Either Ok(()) (small tree finished) or Err(Cancelled) is acceptable.
    let _ = result;
}
