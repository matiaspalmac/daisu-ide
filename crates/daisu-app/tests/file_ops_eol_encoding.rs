use daisu_app::commands::file_ops::{
    convert_eol_inner, read_file_with_encoding_inner, save_file_with_encoding_inner,
};

#[tokio::test]
async fn convert_eol_lf_to_crlf_writes_atomic() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("a.txt");
    tokio::fs::write(&path, b"line1\nline2\nline3\n")
        .await
        .unwrap();
    convert_eol_inner(&path, "CRLF").await.unwrap();
    let bytes = tokio::fs::read(&path).await.unwrap();
    assert_eq!(bytes, b"line1\r\nline2\r\nline3\r\n");
}

#[tokio::test]
async fn convert_eol_crlf_to_lf_writes_atomic() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("b.txt");
    tokio::fs::write(&path, b"x\r\ny\r\n").await.unwrap();
    convert_eol_inner(&path, "LF").await.unwrap();
    let bytes = tokio::fs::read(&path).await.unwrap();
    assert_eq!(bytes, b"x\ny\n");
}

#[tokio::test]
async fn convert_eol_unknown_target_returns_error() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("c.txt");
    tokio::fs::write(&path, b"hi\n").await.unwrap();
    let err = convert_eol_inner(&path, "XYZ").await.unwrap_err();
    assert!(matches!(err, daisu_app::AppError::Internal(_)));
}

#[tokio::test]
async fn read_file_with_encoding_utf8_decodes() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("u.txt");
    tokio::fs::write(&path, "héllo\n".as_bytes()).await.unwrap();
    let opened = read_file_with_encoding_inner(&path, "UTF-8").await.unwrap();
    assert_eq!(opened.contents, "héllo\n");
    assert_eq!(opened.encoding, "UTF-8");
}

#[tokio::test]
async fn read_file_with_encoding_utf16_decodes() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("u16.txt");
    let bytes_le: Vec<u8> = "hi\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut full = vec![0xFFu8, 0xFE];
    full.extend(bytes_le);
    tokio::fs::write(&path, &full).await.unwrap();
    let opened = read_file_with_encoding_inner(&path, "UTF-16LE")
        .await
        .unwrap();
    assert_eq!(opened.contents, "hi\n");
    assert_eq!(opened.encoding, "UTF-16LE");
}

#[tokio::test]
async fn save_file_with_encoding_round_trips_shift_jis() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("sjis.txt");
    let original = "日本語\n";
    save_file_with_encoding_inner(&path, original, "Shift_JIS")
        .await
        .unwrap();
    let on_disk = tokio::fs::read(&path).await.unwrap();
    // Shift_JIS encodes "日" as 0x93 0xfa, "本" as 0x96 0x7b, "語" as 0x8c 0xea.
    assert_eq!(on_disk, vec![0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, b'\n']);
    let opened = read_file_with_encoding_inner(&path, "Shift_JIS")
        .await
        .unwrap();
    assert_eq!(opened.contents, original);
}

#[tokio::test]
async fn save_file_with_encoding_rejects_unrepresentable_chars() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("bad.txt");
    // Emoji is not representable in Shift_JIS — must error rather than
    // silently writing replacement bytes.
    let err = save_file_with_encoding_inner(&path, "🎌", "Shift_JIS")
        .await
        .unwrap_err();
    assert!(matches!(err, daisu_app::AppError::Internal(_)));
}

#[tokio::test]
async fn save_file_with_encoding_unknown_returns_error() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("x.txt");
    let err = save_file_with_encoding_inner(&path, "hi", "BOGUS")
        .await
        .unwrap_err();
    assert!(matches!(err, daisu_app::AppError::Internal(_)));
}

#[tokio::test]
async fn save_file_with_encoding_does_not_create_missing_parent_dirs() {
    // Aligns behaviour with `save_file` / `convert_eol_inner`: a typo
    // in the path should fail loudly rather than silently materialising
    // a directory tree.
    let tmp = tempfile::tempdir().unwrap();
    let nonexistent_dir = tmp.path().join("does").join("not").join("exist");
    let path = nonexistent_dir.join("file.txt");
    let err = save_file_with_encoding_inner(&path, "hi", "UTF-8")
        .await
        .unwrap_err();
    assert!(
        matches!(err, daisu_app::AppError::IoError { .. }),
        "expected IoError for missing parent dir, got {err:?}"
    );
    // Crucially: the parent tree should NOT have been created.
    assert!(!nonexistent_dir.exists());
}

#[tokio::test]
async fn save_file_with_encoding_writes_atomically_via_tempfile() {
    // The implementation should write to a sibling tempfile and rename
    // into place so a crash mid-write can't leave a half-written file.
    // We can verify the rename happens cleanly by inspecting the final
    // directory listing — only the target file remains, no `.tmp` left
    // behind.
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("payload.txt");
    save_file_with_encoding_inner(&path, "hello", "UTF-8")
        .await
        .unwrap();
    let entries: Vec<_> = std::fs::read_dir(tmp.path())
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(entries, vec!["payload.txt"]);
    assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), "hello");
}

#[tokio::test]
async fn read_file_with_encoding_unknown_returns_error() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("u.txt");
    tokio::fs::write(&path, b"hi\n").await.unwrap();
    let err = read_file_with_encoding_inner(&path, "BOGUS")
        .await
        .unwrap_err();
    assert!(matches!(err, daisu_app::AppError::Internal(_)));
}
