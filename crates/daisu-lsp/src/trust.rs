//! Workspace trust gate.
//!
//! Language servers run arbitrary project code: `build.rs`, proc
//! macros, `package.json` scripts. Spawning rust-analyzer in an
//! untrusted clone is RCE. We require the user to explicitly trust a
//! workspace path before any server can spawn there.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{LspError, LspResult};

const TRUST_FILE: &str = ".daisu/trust.toml";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TrustFile {
    /// Absolute, canonicalised workspace path that the user trusted.
    path: String,
    /// ISO-8601 timestamp of when trust was granted.
    granted_at: String,
}

/// Returns true if `workspace` has a valid trust marker. Marker is
/// invalid if its `path` does not match the canonicalised workspace
/// path (defends against directory rename / symlink games).
pub fn is_trusted(workspace: &Path) -> LspResult<bool> {
    let canonical = canonicalise(workspace)?;
    let marker = canonical.join(TRUST_FILE);
    if !marker.exists() {
        return Ok(false);
    }
    let raw = std::fs::read_to_string(&marker)?;
    let parsed: TrustFile = toml::from_str(&raw)?;
    let stored = PathBuf::from(parsed.path);
    let stored_canonical = canonicalise(&stored).unwrap_or(stored);
    Ok(stored_canonical == canonical)
}

/// Write a trust marker for `workspace`. Creates `.daisu/` if needed.
pub fn grant(workspace: &Path) -> LspResult<()> {
    let canonical = canonicalise(workspace)?;
    let dir = canonical.join(".daisu");
    std::fs::create_dir_all(&dir)?;
    let marker = dir.join("trust.toml");
    let body = TrustFile {
        path: canonical.to_string_lossy().into_owned(),
        granted_at: chrono::Utc::now().to_rfc3339(),
    };
    let serialised = toml::to_string(&body).map_err(|e| LspError::Trust(e.to_string()))?;
    std::fs::write(&marker, serialised)?;
    Ok(())
}

/// Remove the trust marker.
pub fn revoke(workspace: &Path) -> LspResult<()> {
    let canonical = canonicalise(workspace)?;
    let marker = canonical.join(TRUST_FILE);
    if marker.exists() {
        std::fs::remove_file(&marker)?;
    }
    Ok(())
}

fn canonicalise(p: &Path) -> LspResult<PathBuf> {
    p.canonicalize()
        .map_err(|e| LspError::Trust(format!("canonicalize {}: {e}", p.display())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untrusted_workspace_returns_false() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(!is_trusted(tmp.path()).unwrap());
    }

    #[test]
    fn grant_then_is_trusted_returns_true() {
        let tmp = tempfile::tempdir().unwrap();
        grant(tmp.path()).unwrap();
        assert!(is_trusted(tmp.path()).unwrap());
    }

    #[test]
    fn revoke_clears_trust() {
        let tmp = tempfile::tempdir().unwrap();
        grant(tmp.path()).unwrap();
        revoke(tmp.path()).unwrap();
        assert!(!is_trusted(tmp.path()).unwrap());
    }

    #[test]
    fn trust_for_non_existent_path_errors() {
        let res = is_trusted(Path::new("/nonexistent/path/12345"));
        assert!(res.is_err());
    }

    #[test]
    fn marker_with_mismatched_path_is_invalid() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join(".daisu")).unwrap();
        let bogus = TrustFile {
            path: "/some/other/path".into(),
            granted_at: chrono::Utc::now().to_rfc3339(),
        };
        std::fs::write(
            tmp.path().join(TRUST_FILE),
            toml::to_string(&bogus).unwrap(),
        )
        .unwrap();
        assert!(!is_trusted(tmp.path()).unwrap());
    }
}
