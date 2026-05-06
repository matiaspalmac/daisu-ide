//! Child-process transport: spawns the server, runs reader/writer
//! background tasks, exposes mpsc channels for framed messages.

use std::process::Stdio;

use tokio::io::BufReader;
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::framing::{read_frame, write_frame};
use crate::LspError;

pub struct Transport {
    pub outgoing: mpsc::UnboundedSender<Vec<u8>>,
    pub incoming: mpsc::UnboundedReceiver<Vec<u8>>,
    /// Tasks spawned for the reader/writer loops. Held so the caller
    /// can `await` graceful shutdown.
    pub handles: Vec<JoinHandle<()>>,
    /// Child process handle. Drop = orphan; call `kill()` for clean
    /// shutdown.
    pub child: Child,
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

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (in_tx, in_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        // Writer task: drain out_rx -> child stdin
        let writer = tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(bytes) = out_rx.recv().await {
                if write_frame(&mut stdin, &bytes).await.is_err() {
                    break;
                }
            }
        });

        // Reader task: pump child stdout -> in_tx
        let reader = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            while let Ok(Some(bytes)) = read_frame(&mut reader).await {
                if in_tx.send(bytes).is_err() {
                    break;
                }
            }
        });

        Ok(Self {
            outgoing: out_tx,
            incoming: in_rx,
            handles: vec![writer, reader],
            child,
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
        } = self;
        drop(outgoing);
        drop(incoming);
        let _ = child.kill().await;
        for h in handles {
            let _ = h.await;
        }
    }
}
