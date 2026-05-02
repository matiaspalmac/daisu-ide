use daisu_app::commands::file_ops::copy_path_at;
use std::path::Path;

#[tokio::test]
async fn copy_file_into_sibling_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let src_dir = tmp.path().join("src");
    let dst_dir = tmp.path().join("dst");
    tokio::fs::create_dir(&src_dir).await.unwrap();
    tokio::fs::create_dir(&dst_dir).await.unwrap();
    let src_file = src_dir.join("a.txt");
    tokio::fs::write(&src_file, b"hello").await.unwrap();

    let result = copy_path_at(&src_file, &dst_dir).await.unwrap();
    let new_path = Path::new(&result);
    assert_eq!(tokio::fs::read(new_path).await.unwrap(), b"hello");
    assert!(src_file.exists());
}

#[tokio::test]
async fn copy_file_into_same_directory_appends_copy_suffix() {
    let tmp = tempfile::tempdir().unwrap();
    let src = tmp.path().join("a.txt");
    tokio::fs::write(&src, b"x").await.unwrap();

    let result = copy_path_at(&src, tmp.path()).await.unwrap();
    let new_name = Path::new(&result).file_name().unwrap().to_string_lossy();
    assert!(new_name.contains("(copy)"), "got {new_name}");
}

#[tokio::test]
async fn copy_dir_recursively_copies_contents() {
    let tmp = tempfile::tempdir().unwrap();
    let src = tmp.path().join("srcdir");
    let dst = tmp.path().join("dstdir");
    tokio::fs::create_dir(&src).await.unwrap();
    tokio::fs::create_dir(&dst).await.unwrap();
    tokio::fs::create_dir(src.join("inner")).await.unwrap();
    tokio::fs::write(src.join("a.txt"), b"a").await.unwrap();
    tokio::fs::write(src.join("inner/b.txt"), b"b")
        .await
        .unwrap();

    let result = copy_path_at(&src, &dst).await.unwrap();
    let new_root = Path::new(&result);
    assert!(new_root.is_dir());
    assert_eq!(tokio::fs::read(new_root.join("a.txt")).await.unwrap(), b"a");
    assert_eq!(
        tokio::fs::read(new_root.join("inner/b.txt")).await.unwrap(),
        b"b"
    );
}

#[tokio::test]
async fn copy_increments_suffix_until_unique() {
    let tmp = tempfile::tempdir().unwrap();
    tokio::fs::write(tmp.path().join("a.txt"), b"orig")
        .await
        .unwrap();
    tokio::fs::write(tmp.path().join("a (copy).txt"), b"first dup")
        .await
        .unwrap();

    let src = tmp.path().join("a.txt");
    let result = copy_path_at(&src, tmp.path()).await.unwrap();
    let new_name = Path::new(&result).file_name().unwrap().to_string_lossy();
    assert!(new_name.contains("(copy 2)"), "got {new_name}");
}
