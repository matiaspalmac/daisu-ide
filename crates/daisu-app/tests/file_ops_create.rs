use daisu_app::commands::file_ops::{create_dir_at, create_file_at};
use std::path::Path;

#[tokio::test]
async fn create_file_writes_empty_file_and_returns_path() {
    let tmp = tempfile::tempdir().unwrap();
    let parent = tmp.path();

    let result = create_file_at(parent, "App.tsx").await.unwrap();
    let new_path = Path::new(&result);
    assert!(new_path.exists());
    assert!(new_path.is_file());
    let bytes = tokio::fs::read(new_path).await.unwrap();
    assert!(bytes.is_empty());
}

#[tokio::test]
async fn create_file_rejects_invalid_name() {
    let tmp = tempfile::tempdir().unwrap();
    let err = create_file_at(tmp.path(), "no/slashes.txt")
        .await
        .unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "InvalidName");
}

#[tokio::test]
async fn create_file_rejects_existing_path() {
    let tmp = tempfile::tempdir().unwrap();
    tokio::fs::write(tmp.path().join("a.txt"), b"existing")
        .await
        .unwrap();
    let err = create_file_at(tmp.path(), "a.txt").await.unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "AlreadyExists");
}

#[tokio::test]
async fn create_file_rejects_when_parent_missing() {
    let bogus = std::path::PathBuf::from("C:\\nope-daisu-test\\inner");
    let err = create_file_at(&bogus, "x.txt").await.unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    let kind = json["kind"].as_str().unwrap();
    // Either NotFound or IoError(NotFound) is acceptable depending on platform.
    assert!(kind == "NotFound" || kind == "IoError", "got {kind}");
}

#[tokio::test]
async fn create_dir_creates_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let result = create_dir_at(tmp.path(), "nested").await.unwrap();
    let new_path = Path::new(&result);
    assert!(new_path.is_dir());
}

#[tokio::test]
async fn create_dir_rejects_when_already_exists() {
    let tmp = tempfile::tempdir().unwrap();
    tokio::fs::create_dir(tmp.path().join("dup")).await.unwrap();
    let err = create_dir_at(tmp.path(), "dup").await.unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "AlreadyExists");
}

#[tokio::test]
async fn create_dir_rejects_invalid_name() {
    let tmp = tempfile::tempdir().unwrap();
    let err = create_dir_at(tmp.path(), "CON").await.unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "InvalidName");
}
