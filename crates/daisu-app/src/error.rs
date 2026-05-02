use serde::{Serialize, Serializer};
use thiserror::Error;

/// Structured error envelope shared between all Tauri commands.
///
/// Every variant serializes to JSON `{ kind, message, context }` so the frontend
/// can map `kind` to user-facing copy via `lib/error-translate.ts`.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("not found: {path}")]
    NotFound { path: String },

    #[error("permission denied: {path}")]
    PermissionDenied { path: String },

    #[error("already exists: {path}")]
    AlreadyExists { path: String },

    #[error("invalid name: {message}")]
    InvalidName { message: String, name: String },

    #[error("io error ({kind}): {message}")]
    IoError { kind: String, message: String },

    #[error("watcher error: {0}")]
    WatcherError(String),

    #[error("operation cancelled")]
    Cancelled,

    #[error("file is not valid utf-8")]
    InvalidUtf8,

    #[error("internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn not_found(path: impl Into<String>) -> Self {
        Self::NotFound { path: path.into() }
    }

    pub fn permission_denied(path: impl Into<String>) -> Self {
        Self::PermissionDenied { path: path.into() }
    }

    pub fn already_exists(path: impl Into<String>) -> Self {
        Self::AlreadyExists { path: path.into() }
    }

    pub fn invalid_name(message: impl Into<String>, name: impl Into<String>) -> Self {
        Self::InvalidName {
            message: message.into(),
            name: name.into(),
        }
    }

    pub fn watcher(message: impl Into<String>) -> Self {
        Self::WatcherError(message.into())
    }

    fn kind_str(&self) -> &'static str {
        match self {
            Self::NotFound { .. } => "NotFound",
            Self::PermissionDenied { .. } => "PermissionDenied",
            Self::AlreadyExists { .. } => "AlreadyExists",
            Self::InvalidName { .. } => "InvalidName",
            Self::IoError { .. } => "IoError",
            Self::WatcherError(_) => "WatcherError",
            Self::Cancelled => "Cancelled",
            Self::InvalidUtf8 => "InvalidUtf8",
            Self::Internal(_) => "Internal",
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        // Map common io::ErrorKind values to dedicated variants where useful;
        // fall back to IoError for everything else.
        match err.kind() {
            std::io::ErrorKind::NotFound => Self::IoError {
                kind: "NotFound".to_string(),
                message: err.to_string(),
            },
            std::io::ErrorKind::PermissionDenied => Self::IoError {
                kind: "PermissionDenied".to_string(),
                message: err.to_string(),
            },
            std::io::ErrorKind::AlreadyExists => Self::IoError {
                kind: "AlreadyExists".to_string(),
                message: err.to_string(),
            },
            other => Self::IoError {
                kind: format!("{other:?}"),
                message: err.to_string(),
            },
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 3)?;
        state.serialize_field("kind", self.kind_str())?;

        // Message is the variant-specific raw payload — no Display prefix —
        // so the frontend translator composes user copy from kind + context
        // without prefix duplication. The Display impl (thiserror) is for
        // server-side logging only.
        let message: String = match self {
            Self::NotFound { path }
            | Self::PermissionDenied { path }
            | Self::AlreadyExists { path } => path.clone(),
            Self::InvalidName { message, .. } | Self::IoError { message, .. } => message.clone(),
            Self::WatcherError(s) | Self::Internal(s) => s.clone(),
            Self::Cancelled => "cancelled".to_string(),
            Self::InvalidUtf8 => "invalid utf-8".to_string(),
        };
        state.serialize_field("message", &message)?;

        let context: serde_json::Value = match self {
            Self::NotFound { path }
            | Self::PermissionDenied { path }
            | Self::AlreadyExists { path } => {
                serde_json::json!({ "path": path })
            }
            Self::InvalidName { name, .. } => serde_json::json!({ "name": name }),
            Self::IoError { kind, .. } => serde_json::json!({ "io_kind": kind }),
            Self::WatcherError(_) | Self::Internal(_) | Self::Cancelled | Self::InvalidUtf8 => {
                serde_json::Value::Null
            }
        };
        state.serialize_field("context", &context)?;
        state.end()
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;
