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
    pub cols: u16,
    pub rows: u16,
}

pub struct TermSession {
    pub id: String,
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub output: broadcast::Sender<Vec<u8>>,
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

impl TermManager {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spawn(&self, opts: TermSpawnOpts) -> Result<String, TermError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: opts.rows.max(1),
                cols: opts.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TermError::Pty(e.to_string()))?;

        let shell = opts.shell.unwrap_or_else(default_shell);
        let mut cmd = CommandBuilder::new(shell);
        cmd.cwd(&opts.cwd);
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| TermError::Pty(e.to_string()))?;
        drop(pair.slave);

        let (tx, _) = broadcast::channel::<Vec<u8>>(1024);
        let id = Uuid::new_v4().to_string();
        let session = TermSession {
            id: id.clone(),
            master: pair.master,
            child,
            output: tx.clone(),
        };

        let reader = session
            .master
            .try_clone_reader()
            .map_err(|e| TermError::Pty(e.to_string()))?;
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
        let s = session.lock();
        let mut writer = s
            .master
            .take_writer()
            .map_err(|e| TermError::Pty(e.to_string()))?;
        std::io::Write::write_all(&mut writer, bytes)?;
        std::io::Write::flush(&mut writer)?;
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
    fn manager_spawn_kill_round_trip() {
        let mgr = TermManager::new();
        let tmp = tempfile::tempdir().unwrap();
        let id = mgr
            .spawn(TermSpawnOpts {
                cwd: tmp.path().display().to_string(),
                shell: None,
                cols: 80,
                rows: 24,
            })
            .expect("spawn");
        assert!(mgr.list().contains(&id));
        mgr.kill(&id).expect("kill");
        assert!(!mgr.list().contains(&id));
    }
}
