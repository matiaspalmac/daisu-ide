use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("path is outside allowed scope")]
    PathOutsideScope,

    #[error("file is not valid utf-8")]
    InvalidUtf8,

    #[error("operation cancelled by user")]
    Cancelled,

    #[error("internal error: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.to_string().as_str())
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;
