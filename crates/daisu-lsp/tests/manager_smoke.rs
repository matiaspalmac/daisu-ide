use std::path::PathBuf;

use daisu_lsp::{LspManager, ResolutionPublic};

#[tokio::test]
async fn manager_loads_default_config_and_reports_statuses() {
    let mgr = LspManager::new();
    let tmp = tempfile::tempdir().unwrap();
    // No lsp.toml present → manager should fall back to defaults.
    mgr.open_workspace(
        tmp.path().to_path_buf(),
        &PathBuf::from("/nonexistent/lsp.toml"),
    )
    .await
    .unwrap();
    let statuses = mgr.statuses().await;
    // Five default servers shipped.
    assert_eq!(statuses.len(), 5);
    let ra = statuses
        .iter()
        .find(|s| s.server_id == "rust-analyzer")
        .unwrap();
    // resolution depends on the test-host PATH; just assert the variant
    // is one of the expected two.
    assert!(matches!(
        ra.resolution,
        ResolutionPublic::Found(_) | ResolutionPublic::Missing
    ));
}
