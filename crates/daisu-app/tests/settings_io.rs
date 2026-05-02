use daisu_app::commands::settings::{export_settings_at, import_settings_at};

#[tokio::test]
async fn export_writes_to_target_path_atomically() {
    let tmp = tempfile::tempdir().unwrap();
    let store_dir = tmp.path().join("source");
    tokio::fs::create_dir_all(&store_dir).await.unwrap();
    let store_file = store_dir.join("settings.json");
    tokio::fs::write(&store_file, r#"{"editor":{"fontSize":13}}"#)
        .await
        .unwrap();

    let target = tmp.path().join("exported.json");
    export_settings_at(&store_file, &target).await.unwrap();

    let copied = tokio::fs::read_to_string(&target).await.unwrap();
    assert!(copied.contains("\"fontSize\":13"));
}

#[tokio::test]
async fn export_overwrites_existing_target() {
    let tmp = tempfile::tempdir().unwrap();
    let store_file = tmp.path().join("settings.json");
    tokio::fs::write(&store_file, r#"{"v":1}"#).await.unwrap();

    let target = tmp.path().join("out.json");
    tokio::fs::write(&target, "old contents").await.unwrap();

    export_settings_at(&store_file, &target).await.unwrap();
    let copied = tokio::fs::read_to_string(&target).await.unwrap();
    assert!(copied.contains("\"v\":1"));
}

#[tokio::test]
async fn export_missing_store_returns_io_error() {
    let tmp = tempfile::tempdir().unwrap();
    let missing = tmp.path().join("does-not-exist.json");
    let target = tmp.path().join("out.json");
    let err = export_settings_at(&missing, &target).await.unwrap_err();
    assert!(matches!(err, daisu_app::AppError::IoError { .. }));
}

#[tokio::test]
async fn import_returns_parsed_json() {
    let tmp = tempfile::tempdir().unwrap();
    let source = tmp.path().join("imported.json");
    tokio::fs::write(&source, r#"{"editor":{"fontSize":18}}"#)
        .await
        .unwrap();

    let value = import_settings_at(&source).await.unwrap();
    let n = value
        .get("editor")
        .and_then(|e| e.get("fontSize"))
        .and_then(serde_json::Value::as_i64)
        .unwrap();
    assert_eq!(n, 18);
}

#[tokio::test]
async fn import_missing_path_returns_io_error() {
    let tmp = tempfile::tempdir().unwrap();
    let missing = tmp.path().join("nope.json");
    let err = import_settings_at(&missing).await.unwrap_err();
    assert!(matches!(err, daisu_app::AppError::IoError { .. }));
}

#[tokio::test]
async fn import_invalid_json_returns_internal() {
    let tmp = tempfile::tempdir().unwrap();
    let source = tmp.path().join("bad.json");
    tokio::fs::write(&source, "{ not json").await.unwrap();
    let err = import_settings_at(&source).await.unwrap_err();
    assert!(matches!(err, daisu_app::AppError::Internal(_)));
}
