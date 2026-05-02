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

/// Create an empty file at `parent/name`. `name` must pass [`validate_filename`].
///
/// # Errors
/// - [`AppError::InvalidName`] if `name` violates filename rules
/// - [`AppError::AlreadyExists`] if the target already exists
/// - [`AppError::IoError`] on other I/O failures (parent missing, permission, ...)
pub async fn create_file_at(parent: &Path, name: &str) -> AppResult<String> {
    crate::validation::validate_filename(name)?;
    let new_path = parent.join(name);
    if tokio::fs::try_exists(&new_path).await.unwrap_or(false) {
        return Err(AppError::already_exists(new_path.display().to_string()));
    }
    let f = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&new_path)
        .await;
    match f {
        Ok(_handle) => Ok(new_path.display().to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(AppError::already_exists(new_path.display().to_string()))
        }
        Err(e) => Err(e.into()),
    }
}

/// Create a directory at `parent/name`. `name` must pass [`validate_filename`].
///
/// # Errors
/// Same as [`create_file_at`] but for directories.
pub async fn create_dir_at(parent: &Path, name: &str) -> AppResult<String> {
    crate::validation::validate_filename(name)?;
    let new_path = parent.join(name);
    if tokio::fs::try_exists(&new_path).await.unwrap_or(false) {
        return Err(AppError::already_exists(new_path.display().to_string()));
    }
    match tokio::fs::create_dir(&new_path).await {
        Ok(()) => Ok(new_path.display().to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(AppError::already_exists(new_path.display().to_string()))
        }
        Err(e) => Err(e.into()),
    }
}

/// Tauri command form of [`create_file_at`].
///
/// # Errors
/// Propagates errors from [`create_file_at`].
#[tauri::command]
pub async fn create_file(parent: String, name: String) -> AppResult<String> {
    create_file_at(Path::new(&parent), &name).await
}

/// Tauri command form of [`create_dir_at`].
///
/// # Errors
/// Propagates errors from [`create_dir_at`].
#[tauri::command]
pub async fn create_dir(parent: String, name: String) -> AppResult<String> {
    create_dir_at(Path::new(&parent), &name).await
}

/// Rename `from` to a sibling at `parent(from)/to_name`.
///
/// `to_name` must pass [`crate::validation::validate_filename`]. The destination must not exist.
/// Operation is atomic on the same volume (Windows / NTFS).
///
/// # Errors
/// - [`AppError::InvalidName`] if `to_name` violates rules
/// - [`AppError::AlreadyExists`] if dest already exists
/// - [`AppError::NotFound`] if source missing
pub async fn rename_path_at(from: &Path, to_name: &str) -> AppResult<String> {
    crate::validation::validate_filename(to_name)?;
    let parent = from
        .parent()
        .ok_or_else(|| AppError::Internal(format!("path has no parent: {}", from.display())))?;
    let dest = parent.join(to_name);
    if !tokio::fs::try_exists(from).await.unwrap_or(false) {
        return Err(AppError::not_found(from.display().to_string()));
    }
    if tokio::fs::try_exists(&dest).await.unwrap_or(false) {
        return Err(AppError::already_exists(dest.display().to_string()));
    }
    tokio::fs::rename(from, &dest).await?;
    Ok(dest.display().to_string())
}

/// Tauri command form of [`rename_path_at`].
///
/// # Errors
/// Propagates errors from [`rename_path_at`].
#[tauri::command]
pub async fn rename_path(from: String, to_name: String) -> AppResult<String> {
    rename_path_at(Path::new(&from), &to_name).await
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrashRef {
    /// Original path before deletion. The frontend uses this for the optimistic
    /// undo flow even when the platform-specific trash handle isn't enough.
    pub original_path: String,
}

/// Move each path to the OS trash. Returns refs the caller stores for undo.
///
/// Uses the `trash` crate which on Windows shells out to the recycle bin.
///
/// # Errors
/// Returns [`AppError::IoError`] only when the `trash` crate failed for every
/// path (none could be moved). Otherwise returns the refs for those that
/// succeeded; partial failures are silently absorbed by design (Phase 2 prefers
/// optimistic UX over halting on partial errors).
pub async fn delete_to_trash_paths(paths: &[String]) -> AppResult<Vec<TrashRef>> {
    let owned: Vec<String> = paths.to_vec();
    let result = tokio::task::spawn_blocking(move || {
        let mut refs: Vec<TrashRef> = Vec::with_capacity(owned.len());
        let mut first_err: Option<String> = None;
        for path in &owned {
            match trash::delete(path) {
                Ok(()) => refs.push(TrashRef {
                    original_path: path.clone(),
                }),
                Err(e) => {
                    if first_err.is_none() {
                        first_err = Some(format!("trash error for {path}: {e}"));
                    }
                }
            }
        }
        (refs, first_err)
    })
    .await
    .map_err(|e| AppError::Internal(format!("blocking task panicked: {e}")))?;

    if result.0.is_empty() {
        if let Some(msg) = result.1 {
            return Err(AppError::IoError {
                kind: "Trash".into(),
                message: msg,
            });
        }
    }
    Ok(result.0)
}

/// Best-effort restore of items previously sent to trash via
/// [`delete_to_trash_paths`].
///
/// # Errors
/// Returns [`AppError::Internal`] only if the blocking task itself panics.
/// Trash crate failures during restore are absorbed silently (Phase 2 surfaces
/// partial-success in the frontend Toast).
pub async fn restore_from_trash_refs(refs: &[TrashRef]) -> AppResult<()> {
    let owned: Vec<TrashRef> = refs.to_vec();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        #[cfg(windows)]
        {
            use trash::os_limited;
            let Ok(items) = os_limited::list() else {
                return Ok(());
            };
            for r in &owned {
                let want = std::path::PathBuf::from(&r.original_path);
                let matches: Vec<_> = items
                    .iter()
                    .filter(|it| it.original_path() == want)
                    .cloned()
                    .collect();
                if !matches.is_empty() {
                    let _ = os_limited::restore_all(matches);
                }
            }
        }
        #[cfg(not(windows))]
        {
            let _ = owned;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(format!("blocking task panicked: {e}")))?
}

/// Tauri command form of [`delete_to_trash_paths`].
///
/// # Errors
/// Propagates errors from [`delete_to_trash_paths`].
#[tauri::command]
pub async fn delete_to_trash(paths: Vec<String>) -> AppResult<Vec<TrashRef>> {
    delete_to_trash_paths(&paths).await
}

/// Tauri command form of [`restore_from_trash_refs`].
///
/// # Errors
/// Propagates errors from [`restore_from_trash_refs`].
#[tauri::command]
pub async fn restore_from_trash(refs: Vec<TrashRef>) -> AppResult<()> {
    restore_from_trash_refs(&refs).await
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
