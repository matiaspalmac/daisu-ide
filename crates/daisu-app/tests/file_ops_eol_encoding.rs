use daisu_app::commands::file_ops::{convert_eol_inner, read_file_with_encoding_inner};

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
async fn read_file_with_encoding_unknown_returns_error() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("u.txt");
    tokio::fs::write(&path, b"hi\n").await.unwrap();
    let err = read_file_with_encoding_inner(&path, "BOGUS")
        .await
        .unwrap_err();
    assert!(matches!(err, daisu_app::AppError::Internal(_)));
}
