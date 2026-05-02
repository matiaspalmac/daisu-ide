use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Read a UTF-8 file from disk.
///
/// # Errors
/// Returns `AppError::Io` if the file cannot be read, or `AppError::InvalidUtf8`
/// if the bytes are not valid UTF-8.
pub async fn read_file_at(path: &Path) -> AppResult<String> {
    let bytes = tokio::fs::read(path).await?;
    String::from_utf8(bytes).map_err(|_| AppError::InvalidUtf8)
}

/// Write a UTF-8 string to disk, replacing any existing contents.
///
/// # Errors
/// Returns `AppError::Io` if the file cannot be written.
pub async fn write_file_at(path: &Path, contents: &str) -> AppResult<()> {
    tokio::fs::write(path, contents.as_bytes()).await?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct OpenedFile {
    pub path: String,
    pub contents: String,
    pub language: String,
}

/// Names skipped at any depth. Hard-coded for Phase 2; Phase 4 will surface
/// these as a user-configurable setting.
const IGNORE_NAMES: &[&str] = &["target", "node_modules", "dist", ".git"];

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    File,
    Dir,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub kind: FileKind,
    pub size: Option<u64>,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: Option<u64>,
}

/// List the immediate children of `path`, filtering ignored names.
///
/// Returns entries unsorted; callers (frontend) handle natural-order sorting
/// because mixed file/dir ordering is a UI concern.
///
/// # Errors
/// Returns [`AppError::NotFound`] / [`AppError::IoError`] on FS failures.
pub async fn list_dir_at(path: &Path) -> AppResult<Vec<FileEntry>> {
    let mut read = match tokio::fs::read_dir(path).await {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::not_found(path.display().to_string()));
        }
        Err(e) => return Err(e.into()),
    };

    let mut out: Vec<FileEntry> = Vec::new();
    while let Some(entry) = read.next_entry().await? {
        let name = entry.file_name().to_string_lossy().into_owned();
        if IGNORE_NAMES.contains(&name.as_str()) {
            continue;
        }
        let Ok(metadata) = entry.metadata().await else {
            continue;
        };
        let kind = if metadata.is_dir() {
            FileKind::Dir
        } else {
            FileKind::File
        };
        let size = metadata.is_file().then_some(metadata.len());
        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
        let path_str = entry.path().to_string_lossy().into_owned();
        out.push(FileEntry {
            path: path_str,
            name,
            kind,
            size,
            mtime_ms,
        });
    }
    Ok(out)
}

/// Tauri command form of [`list_dir_at`].
///
/// # Errors
/// Propagates errors from [`list_dir_at`].
#[tauri::command]
pub async fn list_dir(path: String) -> AppResult<Vec<FileEntry>> {
    list_dir_at(Path::new(&path)).await
}

#[must_use]
pub fn detect_language(path: &Path) -> String {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    match ext {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "json" => "json",
        "md" | "markdown" => "markdown",
        "toml" => "toml",
        "yml" | "yaml" => "yaml",
        "html" | "htm" => "html",
        "css" => "css",
        "py" => "python",
        "go" => "go",
        _ => "plaintext",
    }
    .to_string()
}

/// Open a file via Tauri command. Returns its contents and detected language.
///
/// # Errors
/// Propagates errors from `read_file_at`.
#[tauri::command]
pub async fn open_file(path: String) -> AppResult<OpenedFile> {
    let pb = PathBuf::from(&path);
    let contents = read_file_at(&pb).await?;
    let language = detect_language(&pb);
    Ok(OpenedFile {
        path,
        contents,
        language,
    })
}

/// Save UTF-8 contents to a file path via Tauri command.
///
/// # Errors
/// Propagates errors from `write_file_at`.
#[tauri::command]
pub async fn save_file(path: String, contents: String) -> AppResult<()> {
    write_file_at(&PathBuf::from(path), &contents).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn read_file_at_returns_contents() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();
        tokio::fs::write(&path, b"hello daisu").await.unwrap();

        let read = read_file_at(&path).await.unwrap();
        assert_eq!(read, "hello daisu");
    }

    #[tokio::test]
    async fn read_file_at_rejects_invalid_utf8() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();
        tokio::fs::write(&path, &[0xff, 0xfe, 0xfd][..])
            .await
            .unwrap();

        let err = read_file_at(&path).await.unwrap_err();
        assert!(matches!(err, AppError::InvalidUtf8));
    }

    #[tokio::test]
    async fn write_file_at_persists_contents() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();
        write_file_at(&path, "saved by daisu").await.unwrap();
        let read = read_file_at(&path).await.unwrap();
        assert_eq!(read, "saved by daisu");
    }

    #[tokio::test]
    async fn write_file_at_overwrites_existing_contents() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();
        write_file_at(&path, "first").await.unwrap();
        write_file_at(&path, "second").await.unwrap();
        assert_eq!(read_file_at(&path).await.unwrap(), "second");
    }

    #[test]
    fn detect_language_all_extensions() {
        let cases: &[(&str, &str)] = &[
            ("a.rs", "rust"),
            ("a.ts", "typescript"),
            ("a.tsx", "typescript"),
            ("a.js", "javascript"),
            ("a.jsx", "javascript"),
            ("a.mjs", "javascript"),
            ("a.cjs", "javascript"),
            ("a.json", "json"),
            ("a.md", "markdown"),
            ("a.markdown", "markdown"),
            ("a.toml", "toml"),
            ("a.yml", "yaml"),
            ("a.yaml", "yaml"),
            ("a.html", "html"),
            ("a.htm", "html"),
            ("a.css", "css"),
            ("a.py", "python"),
            ("a.go", "go"),
            ("a.unknown", "plaintext"),
        ];
        for (file, expected) in cases {
            assert_eq!(
                detect_language(Path::new(file)),
                *expected,
                "ext for {file}"
            );
        }
    }
}
