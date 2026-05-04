use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("provider {0:?} not configured")]
    ProviderNotConfigured(String),

    #[error("missing api key for provider {0}")]
    MissingApiKey(String),

    #[error("provider returned error: {0}")]
    Provider(String),

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("keychain error: {0}")]
    Keychain(#[from] keyring::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("permission denied for tool {tool}: {reason}")]
    PermissionDenied { tool: String, reason: String },

    #[error("tool execution failed: {0}")]
    ToolExecution(String),

    #[error("conversation cancelled")]
    Cancelled,

    #[error("internal: {0}")]
    Internal(String),
}

pub type AgentResult<T> = Result<T, AgentError>;
