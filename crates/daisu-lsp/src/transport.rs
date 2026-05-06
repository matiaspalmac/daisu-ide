//! Child-process transport: spawns the server, runs reader/writer/stderr
//! background tasks, exposes mpsc channels for framed messages plus a
//! watch channel that fires when stdout closes (proxy for child death).

use std::process::Stdio;
use std::sync::Arc;

use parking_lot::Mutex;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::framing::{read_frame, write_frame};
use crate::LspError;

/// Cap on retained stderr lines per server. Surfaces startup failures
/// (`rust-analyzer` rustup-stub error, missing node version, malformed
/// config) without unbounded growth from a chatty server that prints
/// progress for hours.
const STDERR_TAIL_LIMIT: usize = 64;

pub struct Transport {
    pub outgoing: mpsc::UnboundedSender<Vec<u8>>,
    pub incoming: mpsc::UnboundedReceiver<Vec<u8>>,
    /// Tasks spawned for the reader/writer/stderr loops. Held so the caller
    /// can `await` graceful shutdown.
    pub handles: Vec<JoinHandle<()>>,
    /// Child process handle. Drop = orphan; call `kill()` for clean
    /// shutdown.
    pub child: Child,
    /// Most recent N stderr lines from the child. The handshake includes
    /// this tail in error messages when the server exits early — without it
    /// daisu has no signal beyond "process gone" and the user faces a
    /// silent dead LSP.
    pub stderr_tail: Arc<Mutex<Vec<String>>>,
    /// `false` while stdout is open; flips to `true` when the reader task
    /// hits EOF. Proxy for child death — once the server closes stdout it
    /// can no longer speak LSP, so awaiters should give up rather than
    /// block on a request that will never get answered.
    pub stdout_eof: watch::Receiver<bool>,
}

impl Transport {
    #[allow(clippy::unused_async)]
    pub async fn spawn(command: &str, args: &[String]) -> Result<Self, LspError> {
        let mut child = Command::new(command)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| LspError::Framing("child stdin not captured".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| LspError::Framing("child stdout not captured".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| LspError::Framing("child stderr not captured".into()))?;

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (in_tx, in_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let stderr_tail = Arc::new(Mutex::new(Vec::with_capacity(STDERR_TAIL_LIMIT)));
        let (eof_tx, eof_rx) = watch::channel(false);

        // Writer task: drain out_rx -> child stdin
        let writer = tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(bytes) = out_rx.recv().await {
                if write_frame(&mut stdin, &bytes).await.is_err() {
                    break;
                }
            }
        });

        // Reader task: pump child stdout -> in_tx. Signals `stdout_eof` on
        // exit so the handshake (and any future request awaiters) can
        // short-circuit instead of blocking forever when the server dies
        // before sending anything — the failure mode triggered by the
        // rustup proxy stub at `~/.cargo/bin/rust-analyzer` when the
        // component isn't installed.
        let reader = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            while let Ok(Some(bytes)) = read_frame(&mut reader).await {
                if in_tx.send(bytes).is_err() {
                    break;
                }
            }
            let _ = eof_tx.send(true);
        });

        // Stderr drain task: capture lines into a bounded ringbuffer.
        // Without an active drainer the OS pipe buffer fills (~64 KB on
        // Windows) and the server blocks on its next stderr write,
        // manifesting as an LSP that mysteriously stops responding
        // mid-session. The captured tail also feeds the handshake error
        // path so we can surface "Unknown binary 'rust-analyzer.exe'" to
        // the UI instead of a silent timeout.
        let stderr_tail_for_task = stderr_tail.clone();
        let stderr_handle = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut buf = stderr_tail_for_task.lock();
                if buf.len() >= STDERR_TAIL_LIMIT {
                    buf.remove(0);
                }
                buf.push(line);
            }
        });

        Ok(Self {
            outgoing: out_tx,
            incoming: in_rx,
            handles: vec![writer, reader, stderr_handle],
            child,
            stderr_tail,
            stdout_eof: eof_rx,
        })
    }

    /// Send SIGTERM (or windows equivalent) and await all background
    /// tasks. Use after sending `exit` notification.
    ///
    /// Drops the outgoing sender first so the writer task can observe
    /// channel closure and break its `recv()` await; then kills the
    /// child so the reader task hits EOF on stdout. Without these
    /// explicit drops the loops wait forever and the `JoinHandle::await`
    /// below hangs the test/runtime.
    pub async fn shutdown(self) {
        let Self {
            outgoing,
            incoming,
            handles,
            mut child,
            stderr_tail: _,
            stdout_eof: _,
        } = self;
        drop(outgoing);
        drop(incoming);
        let _ = child.kill().await;
        for h in handles {
            let _ = h.await;
        }
    }
}
