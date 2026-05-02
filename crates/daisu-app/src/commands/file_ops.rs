use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Read a UTF-8 file from disk. Pure function; no Tauri dependency.
///
/// # Errors
///
/// Returns [`AppError::Io`] if the file cannot be read, or [`AppError::InvalidUtf8`] if
/// the file contents are not valid UTF-8.
pub fn read_file_at(path: &Path) -> AppResult<String> {
    let bytes = std::fs::read(path)?;
    String::from_utf8(bytes).map_err(|_| AppError::InvalidUtf8)
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

/// Open a file at the given path and return its contents with language detection.
///
/// # Errors
///
/// Returns [`AppError::Io`] if the file cannot be read, or [`AppError::InvalidUtf8`] if
/// the file contents are not valid UTF-8.
#[tauri::command]
pub async fn open_file(path: String) -> AppResult<OpenedFile> {
    let pb = PathBuf::from(&path);
    let contents = read_file_at(&pb)?;
    let language = detect_language(&pb);
    Ok(OpenedFile {
        path,
        contents,
        language,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn read_file_at_returns_contents() {
        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        write!(tmp, "hello daisu").unwrap();
        let read = read_file_at(tmp.path()).unwrap();
        assert_eq!(read, "hello daisu");
    }

    #[test]
    fn read_file_at_rejects_invalid_utf8() {
        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        tmp.write_all(&[0xff, 0xfe, 0xfd]).unwrap();
        let err = read_file_at(tmp.path()).unwrap_err();
        assert!(matches!(err, AppError::InvalidUtf8));
    }

    #[test]
    fn detect_language_known_extensions() {
        assert_eq!(detect_language(Path::new("a.rs")), "rust");
        assert_eq!(detect_language(Path::new("a.tsx")), "typescript");
        assert_eq!(detect_language(Path::new("a.unknown")), "plaintext");
    }
}
