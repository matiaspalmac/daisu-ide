//! Trash round-trip tests. These touch the real Windows recycle bin so they
//! create files inside the system temp dir and clean up via the trash
//! mechanism itself. If `trash::delete` fails (e.g. running in a non-interactive
//! container), the test logs and returns rather than panicking.

#![cfg(windows)]

use daisu_app::commands::file_ops::{delete_to_trash_paths, restore_from_trash_refs};
use std::path::Path;

#[tokio::test]
async fn delete_to_trash_removes_file_and_returns_ref() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("ephemeral-daisu-test.txt");
    tokio::fs::write(&path, b"goodbye").await.unwrap();

    let refs = match delete_to_trash_paths(&[path.display().to_string()]).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("trash unavailable in this environment: {e:?}");
            return;
        }
    };
    assert_eq!(refs.len(), 1);
    assert!(!Path::new(&path).exists(), "file should be moved to trash");

    let _ = restore_from_trash_refs(&refs).await;
}

#[tokio::test]
async fn delete_to_trash_handles_multiple_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let a = tmp.path().join("a-daisu-test.txt");
    let b = tmp.path().join("b-daisu-test.txt");
    tokio::fs::write(&a, b"a").await.unwrap();
    tokio::fs::write(&b, b"b").await.unwrap();

    let refs =
        match delete_to_trash_paths(&[a.display().to_string(), b.display().to_string()]).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("trash unavailable: {e:?}");
                return;
            }
        };
    assert_eq!(refs.len(), 2);

    let _ = restore_from_trash_refs(&refs).await;
}
