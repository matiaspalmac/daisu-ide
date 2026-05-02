use daisu_app::commands::session::{delete_session_at, load_session_at, save_session_at};

#[tokio::test]
async fn save_and_load_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();

    let blob = serde_json::json!({
        "version": 1,
        "tabs": [{ "id": "abc", "name": "App.tsx" }],
    });
    save_session_at(root, "hash-1", &blob).await.unwrap();

    let loaded = load_session_at(root, "hash-1").await.unwrap();
    assert_eq!(loaded, Some(blob));
}

#[tokio::test]
async fn load_returns_none_for_missing_workspace() {
    let tmp = tempfile::tempdir().unwrap();
    let loaded = load_session_at(tmp.path(), "nope").await.unwrap();
    assert!(loaded.is_none());
}

#[tokio::test]
async fn load_returns_none_for_malformed_json() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("hash-2");
    tokio::fs::create_dir_all(&dir).await.unwrap();
    tokio::fs::write(dir.join("session.json"), b"{ not valid json")
        .await
        .unwrap();

    let loaded = load_session_at(tmp.path(), "hash-2").await.unwrap();
    assert!(loaded.is_none());
}

#[tokio::test]
async fn save_creates_parent_dir_on_first_call() {
    let tmp = tempfile::tempdir().unwrap();
    let blob = serde_json::json!({ "tabs": [] });
    save_session_at(tmp.path(), "fresh-hash", &blob)
        .await
        .unwrap();
    let dir = tmp.path().join("fresh-hash");
    assert!(dir.is_dir());
    assert!(dir.join("session.json").is_file());
}

#[tokio::test]
async fn save_uses_atomic_rename() {
    let tmp = tempfile::tempdir().unwrap();
    let blob_one = serde_json::json!({ "version": 1, "tabs": [1] });
    let blob_two = serde_json::json!({ "version": 1, "tabs": [1, 2] });

    save_session_at(tmp.path(), "h", &blob_one).await.unwrap();
    save_session_at(tmp.path(), "h", &blob_two).await.unwrap();
    let loaded = load_session_at(tmp.path(), "h").await.unwrap();
    assert_eq!(loaded, Some(blob_two));

    let dir = tmp.path().join("h");
    let mut read = tokio::fs::read_dir(&dir).await.unwrap();
    let mut names: Vec<String> = Vec::new();
    while let Some(e) = read.next_entry().await.unwrap() {
        names.push(e.file_name().to_string_lossy().into_owned());
    }
    names.sort();
    assert_eq!(names, vec!["session.json"]);
}

#[tokio::test]
async fn delete_removes_session_file() {
    let tmp = tempfile::tempdir().unwrap();
    let blob = serde_json::json!({ "tabs": [] });
    save_session_at(tmp.path(), "h", &blob).await.unwrap();
    delete_session_at(tmp.path(), "h").await.unwrap();
    let loaded = load_session_at(tmp.path(), "h").await.unwrap();
    assert!(loaded.is_none());
}

#[tokio::test]
async fn delete_is_idempotent_for_missing() {
    let tmp = tempfile::tempdir().unwrap();
    delete_session_at(tmp.path(), "nope").await.unwrap();
}
