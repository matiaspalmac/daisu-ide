use daisu_app::commands::file_ops::{list_dir_at, FileEntry, FileKind};
use std::path::PathBuf;

#[tokio::test]
async fn list_dir_returns_files_and_directories() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    tokio::fs::create_dir(root.join("subdir")).await.unwrap();
    tokio::fs::write(root.join("a.txt"), b"hi").await.unwrap();
    tokio::fs::write(root.join("b.rs"), b"fn main() {}")
        .await
        .unwrap();

    let mut entries = list_dir_at(&PathBuf::from(root)).await.unwrap();
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["a.txt", "b.rs", "subdir"]);
    assert!(matches!(entries[2].kind, FileKind::Dir));
    assert!(matches!(entries[0].kind, FileKind::File));
}

#[tokio::test]
async fn list_dir_returns_not_found_for_missing_path() {
    let res = list_dir_at(&PathBuf::from("C:\\definitely-does-not-exist-daisu")).await;
    let err = res.unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    let kind = json["kind"].as_str().unwrap();
    assert!(
        kind == "NotFound" || kind == "IoError",
        "expected NotFound or IoError, got {kind}"
    );
}

#[tokio::test]
async fn list_dir_filters_default_ignores() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    tokio::fs::create_dir(root.join("node_modules"))
        .await
        .unwrap();
    tokio::fs::create_dir(root.join("target")).await.unwrap();
    tokio::fs::create_dir(root.join("dist")).await.unwrap();
    tokio::fs::create_dir(root.join(".git")).await.unwrap();
    tokio::fs::create_dir(root.join("src")).await.unwrap();

    let entries = list_dir_at(&PathBuf::from(root)).await.unwrap();
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["src"]);
}

#[tokio::test]
async fn list_dir_returns_size_for_files() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    tokio::fs::write(root.join("data.bin"), &[0u8; 1234])
        .await
        .unwrap();
    let entries = list_dir_at(&PathBuf::from(root)).await.unwrap();
    let entry: &FileEntry = entries.iter().find(|e| e.name == "data.bin").unwrap();
    assert_eq!(entry.size, Some(1234));
    assert!(matches!(entry.kind, FileKind::File));
}
