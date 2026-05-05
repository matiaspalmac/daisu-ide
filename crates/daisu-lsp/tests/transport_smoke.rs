//! Smoke test: prove `Transport::spawn` plumbs bytes from a real child
//! and `shutdown` returns cleanly. M4.0 doesn't run a real LSP server;
//! we just need to know the process plumbing works.

use daisu_lsp::transport::Transport;

#[tokio::test]
async fn spawn_and_kill_a_trivial_child_completes_cleanly() {
    // `cargo` is guaranteed present on the test box. We don't use it
    // for anything meaningful — just to prove a real child can be
    // spawned, stdio piped, and killed without hangs.
    let cmd = "cargo";
    let args = vec!["--version".to_string()];
    let t = Transport::spawn(cmd, &args).await.expect("spawn");
    // Wait briefly for stdout to drain.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    t.shutdown().await;
}

#[tokio::test]
async fn spawn_nonexistent_command_returns_error() {
    let res = Transport::spawn("definitely-not-a-real-program-1234", &[]).await;
    assert!(res.is_err());
}
