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
        tokio::fs::write(&path, &[0xff, 0xfe, 0xfd][..]).await.unwrap();

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
