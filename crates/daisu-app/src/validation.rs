//! Filename validation. Pure function; no I/O, no Tauri imports.
//!
//! Phase 2 enforces Windows-compatible filename rules so the rules apply
//! uniformly even though the app is Windows-only — keeping cross-platform
//! parity for any future M2+ port.

use crate::error::AppError;

const ILLEGAL_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

const MAX_LEN: usize = 255;

/// Validate a single path component (filename only, not a full path).
///
/// # Errors
/// Returns [`AppError::InvalidName`] if the name violates any rule.
pub fn validate_filename(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return err(name, "Name cannot be empty");
    }
    if name.len() > MAX_LEN {
        return err(name, "Name is longer than 255 bytes");
    }
    if name.chars().any(|c| ILLEGAL_CHARS.contains(&c)) {
        return err(
            name,
            "Name contains an illegal character (one of < > : \" / \\ | ? *)",
        );
    }
    if name
        .chars()
        .any(|c| (c as u32) < 0x20 || (c as u32) == 0x7f)
    {
        return err(name, "Name contains a control character");
    }
    if name.starts_with(' ') || name.ends_with(' ') {
        return err(name, "Name cannot start or end with a space");
    }
    if name.ends_with('.') {
        return err(name, "Name cannot end with a dot");
    }
    // Reject "." / ".." / "..." (dot-only names) but allow ".gitignore", ".env".
    if name.chars().all(|c| c == '.') {
        return err(name, "Name cannot be only dots");
    }
    // Stem before the first dot. Compared case-insensitively against reserved list.
    let stem = name.split('.').next().unwrap_or(name);
    if !stem.is_empty() {
        let upper = stem.to_ascii_uppercase();
        if RESERVED_NAMES.iter().any(|r| *r == upper) {
            return err(name, &format!("Reserved Windows name '{stem}'"));
        }
    }
    Ok(())
}

fn err(name: &str, message: &str) -> Result<(), AppError> {
    Err(AppError::invalid_name(
        message.to_string(),
        name.to_string(),
    ))
}
