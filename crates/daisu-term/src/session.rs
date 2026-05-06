//! `TermSession` — owns the PTY pair, child process, and the reader
//! task that pumps bytes to a broadcast channel.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::TermError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermSpawnOpts {
    pub cwd: String,
    /// Override default shell (e.g. "pwsh", "bash"). When `None`,
    /// auto-detected from environment.
    #[serde(default)]
    pub shell: Option<String>,
    /// Optional id from the shell-detection picker. When set, takes
    /// precedence over `shell` and provides default args (e.g. Git Bash
    /// gets `--login -i`).
    #[serde(default)]
    pub shell_id: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

pub struct TermSession {
    pub id: String,
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub output: broadcast::Sender<Vec<u8>>,
    /// Writer half of the master PTY. `MasterPty::take_writer` is
    /// one-shot per session, so we take it once at spawn and re-use it
    /// for every subsequent `write` call.
    pub writer: Box<dyn std::io::Write + Send>,
}

#[derive(Default)]
pub struct TermManager {
    sessions: Arc<Mutex<HashMap<String, Arc<Mutex<TermSession>>>>>,
}

fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("ComSpec").unwrap_or_else(|_| "powershell.exe".into())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
}

/// Resolve the `(path, args)` to spawn for a `TermSpawnOpts`. Order:
/// 1. `shell_id` from the detection picker (uses canonical args).
/// 2. `shell` override (legacy, no args).
/// 3. `default_shell()` env probe.
fn resolve_spawn_target(opts: &TermSpawnOpts) -> (String, Vec<String>) {
    if let Some(id) = opts.shell_id.as_deref() {
        if let Some(detected) = crate::shells::shell_by_id(id) {
            return (detected.path, detected.args);
        }
    }
    if let Some(s) = opts.shell.as_ref() {
        return (s.clone(), vec![]);
    }
    (default_shell(), vec![])
}

/// Resolve the spawn cwd. When the caller passes an empty string, ".",
/// or a non-existent directory, fall back to the user's home directory —
/// matches `VSCode`'s behaviour when no workspace folder is open. Avoids
/// crashes on Windows where the process cwd may resolve to a read-only
/// `Program Files` location.
fn resolve_cwd(cwd: &str) -> String {
    let needs_fallback = cwd.is_empty() || cwd == "." || !std::path::Path::new(cwd).is_dir();
    if needs_fallback {
        if let Some(home) = dirs::home_dir() {
            return home.display().to_string();
        }
    }
    cwd.to_string()
}

impl TermManager {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spawn(&self, opts: &TermSpawnOpts) -> Result<String, TermError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: opts.rows.max(1),
                cols: opts.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TermError::Pty(e.to_string()))?;

        let (shell_path, shell_args) = resolve_spawn_target(opts);
        let mut cmd = CommandBuilder::new(shell_path);
        for arg in shell_args {
            cmd.arg(arg);
        }
        cmd.cwd(resolve_cwd(&opts.cwd));
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| TermError::Pty(e.to_string()))?;
        // Dropping the slave on Windows can race the child process and
        // leave the writer half in a "broken pipe" state — wezterm#4206.
        // Only drop on Unix where it's required to avoid keeping a stale
        // fd reference open.
        #[cfg(not(windows))]
        drop(pair.slave);

        let (tx, _) = broadcast::channel::<Vec<u8>>(1024);
        let id = Uuid::new_v4().to_string();
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| TermError::Pty(e.to_string()))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| TermError::Pty(e.to_string()))?;
        let session = TermSession {
            id: id.clone(),
            master: pair.master,
            child,
            output: tx.clone(),
            writer,
        };

        let tx_for_reader = tx.clone();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 8192];
            loop {
                match std::io::Read::read(&mut reader, &mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_for_reader.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let arc = Arc::new(Mutex::new(session));
        self.sessions.lock().insert(id.clone(), arc);
        Ok(id)
    }

    pub fn write(&self, id: &str, bytes: &[u8]) -> Result<(), TermError> {
        let session = self
            .sessions
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| TermError::NotFound(id.into()))?;
        let mut s = session.lock();
        std::io::Write::write_all(&mut s.writer, bytes)?;
        std::io::Write::flush(&mut s.writer)?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), TermError> {
        let session = self
            .sessions
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| TermError::NotFound(id.into()))?;
        let s = session.lock();
        s.master
            .resize(PtySize {
                cols: cols.max(1),
                rows: rows.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TermError::Pty(e.to_string()))?;
        Ok(())
    }

    pub fn kill(&self, id: &str) -> Result<(), TermError> {
        let session = self
            .sessions
            .lock()
            .remove(id)
            .ok_or_else(|| TermError::NotFound(id.into()))?;
        let mut s = session.lock();
        let _ = s.child.kill();
        Ok(())
    }

    pub fn subscribe(&self, id: &str) -> Result<broadcast::Receiver<Vec<u8>>, TermError> {
        let session = self
            .sessions
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| TermError::NotFound(id.into()))?;
        let s = session.lock();
        let rx = s.output.subscribe();
        Ok(rx)
    }

    #[must_use]
    pub fn list(&self) -> Vec<String> {
        self.sessions.lock().keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_cwd_falls_back_to_home_when_empty() {
        let home = dirs::home_dir().expect("home dir on this platform");
        assert_eq!(resolve_cwd(""), home.display().to_string());
        assert_eq!(resolve_cwd("."), home.display().to_string());
    }

    #[test]
    fn resolve_cwd_falls_back_when_path_does_not_exist() {
        let home = dirs::home_dir().expect("home dir on this platform");
        assert_eq!(
            resolve_cwd("/this/path/definitely/does/not/exist/xyz123"),
            home.display().to_string(),
        );
    }

    #[test]
    fn resolve_cwd_keeps_existing_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().display().to_string();
        assert_eq!(resolve_cwd(&p), p);
    }

    #[test]
    fn manager_spawn_kill_round_trip() {
        let mgr = TermManager::new();
        let tmp = tempfile::tempdir().unwrap();
        let id = mgr
            .spawn(&TermSpawnOpts {
                cwd: tmp.path().display().to_string(),
                shell: None,
                shell_id: None,
                cols: 80,
                rows: 24,
            })
            .expect("spawn");
        assert!(mgr.list().contains(&id));
        mgr.kill(&id).expect("kill");
        assert!(!mgr.list().contains(&id));
    }
}
