use daisu_app::commands::file_ops::rename_path_at;
use std::path::Path;

#[tokio::test]
async fn rename_file_to_new_name_succeeds() {
    let tmp = tempfile::tempdir().unwrap();
    let from = tmp.path().join("old.txt");
    tokio::fs::write(&from, b"hi").await.unwrap();

    let new_full = rename_path_at(&from, "new.txt").await.unwrap();
    let new_path = Path::new(&new_full);
    assert!(new_path.exists());
    assert!(!from.exists());
    assert_eq!(tokio::fs::read(new_path).await.unwrap(), b"hi");
}

#[tokio::test]
async fn rename_dir_succeeds() {
    let tmp = tempfile::tempdir().unwrap();
    let from = tmp.path().join("olddir");
    tokio::fs::create_dir(&from).await.unwrap();
    tokio::fs::write(from.join("inner.txt"), b"x")
        .await
        .unwrap();

    let new_full = rename_path_at(&from, "newdir").await.unwrap();
    let new_path = Path::new(&new_full);
    assert!(new_path.is_dir());
    assert!(new_path.join("inner.txt").exists());
}

#[tokio::test]
async fn rename_rejects_invalid_new_name() {
    let tmp = tempfile::tempdir().unwrap();
    let from = tmp.path().join("a.txt");
    tokio::fs::write(&from, b"x").await.unwrap();

    let err = rename_path_at(&from, "bad/name").await.unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "InvalidName");
}

#[tokio::test]
async fn rename_rejects_when_dest_exists() {
    let tmp = tempfile::tempdir().unwrap();
    let from = tmp.path().join("a.txt");
    let dest = tmp.path().join("b.txt");
    tokio::fs::write(&from, b"a").await.unwrap();
    tokio::fs::write(&dest, b"b").await.unwrap();

    let err = rename_path_at(&from, "b.txt").await.unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "AlreadyExists");
}

#[tokio::test]
async fn rename_rejects_when_source_missing() {
    let tmp = tempfile::tempdir().unwrap();
    let bogus = tmp.path().join("nope.txt");
    let err = rename_path_at(&bogus, "x.txt").await.unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    let kind = json["kind"].as_str().unwrap();
    assert!(kind == "NotFound" || kind == "IoError", "got {kind}");
}
