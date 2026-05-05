//! Daisu embedded PTY terminal.
//!
//! Backend: `portable-pty` spawns the user shell, owns the master PTY,
//! pumps reader output to a tokio broadcast channel. Frontend (xterm.js)
//! drives input via `write` and `resize` calls. One `TermSession` per
//! tab; sessions live in `TermManager`.

#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::must_use_candidate,
    clippy::match_same_arms,
    clippy::module_name_repetitions
)]

pub mod session;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum TermError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("pty: {0}")]
    Pty(String),
    #[error("session not found: {0}")]
    NotFound(String),
}

pub type TermResult<T> = Result<T, TermError>;

pub use session::{TermManager, TermSession, TermSpawnOpts};
