//! Server discovery: resolve a configured `command` to an absolute
//! path on disk, reporting whether the binary is reachable.

use std::path::PathBuf;

use crate::config::ServerConfig;

#[derive(Debug, Clone)]
pub enum Resolution {
    /// Found on PATH (or absolute path verified to exist).
    Found(PathBuf),
    /// Configured command does not exist on PATH or filesystem.
    Missing,
}

#[must_use]
pub fn resolve(server: &ServerConfig) -> Resolution {
    let cmd = std::path::Path::new(&server.command);
    if cmd.is_absolute() {
        return if cmd.exists() {
            Resolution::Found(cmd.to_path_buf())
        } else {
            Resolution::Missing
        };
    }
    // Probe PATH.
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path_var) {
        for ext in candidate_extensions() {
            let candidate = dir.join(format!("{}{ext}", server.command));
            if candidate.exists() {
                return Resolution::Found(candidate);
            }
        }
    }
    Resolution::Missing
}

#[cfg(target_os = "windows")]
fn candidate_extensions() -> &'static [&'static str] {
    &["", ".exe", ".cmd", ".bat"]
}

#[cfg(not(target_os = "windows"))]
fn candidate_extensions() -> &'static [&'static str] {
    &[""]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ServerConfig;

    fn make(cmd: &str) -> ServerConfig {
        ServerConfig {
            id: "x".into(),
            command: cmd.into(),
            args: vec![],
            languages: vec!["x".into()],
            initialization_options: None,
        }
    }

    #[test]
    fn missing_command_resolves_missing() {
        let s = make("definitely-not-a-real-binary-xyz123");
        assert!(matches!(resolve(&s), Resolution::Missing));
    }

    #[test]
    fn cargo_resolves_to_a_real_path() {
        // `cargo` is guaranteed present on a Rust dev box.
        let s = make("cargo");
        match resolve(&s) {
            Resolution::Found(p) => assert!(p.exists()),
            Resolution::Missing => panic!("cargo should resolve on a Rust dev environment"),
        }
    }
}
