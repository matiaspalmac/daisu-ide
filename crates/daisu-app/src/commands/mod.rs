pub mod file_ops;
pub mod session;
pub mod settings;
pub mod themes;
pub mod webview;
pub mod workspace;

pub use file_ops::{open_file, save_file};
pub use webview::detect_webview2;
