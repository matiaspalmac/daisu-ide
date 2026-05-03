//! Git overlay subsystem. Phase 5 owns repository handle caching, status
//! enumeration, branch listing, checkout, and fetch.

pub mod branch;
pub mod repo_handle;
pub mod status;

#[derive(Debug, Clone, serde::Serialize)]
pub enum GitFileStatus {
    Modified,
    Untracked,
    Conflict,
    Staged,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitWorkspaceInfo {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub remote_url: Option<String>,
    pub statuses: std::collections::HashMap<String, GitFileStatus>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FetchResult {
    pub commits_received: u32,
    pub remote: String,
}
