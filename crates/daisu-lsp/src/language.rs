//! Map filesystem path → LSP language id (matches Monaco language ids).

use std::path::Path;

#[must_use]
pub fn language_for(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?;
    Some(match ext.to_ascii_lowercase().as_str() {
        "rs" => "rust",
        "ts" => "typescript",
        "tsx" => "typescriptreact",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "javascriptreact",
        "py" => "python",
        "go" => "go",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => "cpp",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn maps_known_extensions() {
        assert_eq!(language_for(&PathBuf::from("a.rs")), Some("rust"));
        assert_eq!(language_for(&PathBuf::from("a.ts")), Some("typescript"));
        assert_eq!(
            language_for(&PathBuf::from("a.TSX")),
            Some("typescriptreact")
        );
        assert_eq!(language_for(&PathBuf::from("a.py")), Some("python"));
    }

    #[test]
    fn unknown_returns_none() {
        assert_eq!(language_for(&PathBuf::from("a.xyz")), None);
        assert_eq!(language_for(&PathBuf::from("noext")), None);
    }
}
