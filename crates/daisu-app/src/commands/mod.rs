pub mod agent;
pub mod discord;
pub mod file_ops;
pub mod git;
pub mod lsp;
pub mod search;
pub mod session;
pub mod settings;
pub mod terminal;
pub mod themes;
pub mod webview;
pub mod workspace;

pub use file_ops::{open_file, save_file};
pub use webview::detect_webview2;
