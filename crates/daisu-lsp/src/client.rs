//! One Client per (workspace, server_id). Owns the child process and
//! the request/notification plumbing.

use std::path::Path;
use std::sync::Arc;

use arc_swap::ArcSwap;
use lsp_types::ServerCapabilities;
use parking_lot::Mutex;
use tokio::sync::mpsc;

use crate::dispatcher::Dispatcher;
use crate::handshake::{perform_initialize, perform_shutdown};
use crate::jsonrpc::{Correlator, NotificationBus};
use crate::transport::Transport;
use crate::{LspError, LspResult};

pub struct Client {
    pub server_id: String,
    pub correlator: Correlator,
    pub bus: NotificationBus,
    pub outgoing: mpsc::UnboundedSender<Vec<u8>>,
    pub capabilities: Arc<ArcSwap<ServerCapabilities>>,
    /// Bounded ringbuffer of stderr lines from the underlying server.
    /// Exposed so the manager can surface failure context (e.g.,
    /// "Unknown binary 'rust-analyzer'") into `ServerStatus.last_error`
    /// when a request times out or the server dies mid-session.
    pub stderr_tail: Arc<Mutex<Vec<String>>>,
    transport_child: tokio::process::Child,
    dispatcher: Dispatcher,
    writer_handle: tokio::task::JoinHandle<()>,
    reader_handle: tokio::task::JoinHandle<()>,
    stderr_handle: tokio::task::JoinHandle<()>,
}

impl Client {
    pub async fn spawn(
        server_id: String,
        command: &str,
        args: &[String],
        workspace: &Path,
        diagnostics: Arc<crate::diagnostics::DiagnosticsCache>,
    ) -> LspResult<Self> {
        let mut transport = Transport::spawn(command, args).await?;
        let correlator = Correlator::default();
        let bus = NotificationBus::default();
        let outgoing = transport.outgoing.clone();

        let (_, dummy_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let incoming = std::mem::replace(&mut transport.incoming, dummy_rx);
        let dispatcher =
            Dispatcher::spawn(incoming, outgoing.clone(), correlator.clone(), bus.clone());

        // Pass the EOF watch + stderr tail so the handshake can fail fast
        // with diagnostic context when the spawned process dies before
        // answering `initialize` (the rustup proxy stub case).
        let stdout_eof = transport.stdout_eof.clone();
        let stderr_tail = transport.stderr_tail.clone();
        let init = perform_initialize(
            &correlator,
            &outgoing,
            workspace,
            stdout_eof,
            stderr_tail.clone(),
        )
        .await?;
        let capabilities = Arc::new(ArcSwap::from_pointee(init.capabilities));

        // Subscribe to bus for publishDiagnostics.
        let mut sub = bus.subscribe();
        let server_id_for_task = server_id.clone();
        let diagnostics_for_task = diagnostics.clone();
        tokio::spawn(async move {
            while let Ok(notif) = sub.recv().await {
                if notif.method != "textDocument/publishDiagnostics" {
                    continue;
                }
                let Some(params) = notif.params else { continue };
                let Ok(parsed) =
                    serde_json::from_value::<lsp_types::PublishDiagnosticsParams>(params)
                else {
                    continue;
                };
                diagnostics_for_task.ingest(crate::diagnostics::DiagnosticEvent {
                    uri: parsed.uri,
                    version: parsed.version,
                    server_id: server_id_for_task.clone(),
                    diagnostics: parsed.diagnostics,
                });
            }
        });

        let mut handles = transport.handles.into_iter();
        let writer_handle = handles
            .next()
            .ok_or_else(|| LspError::Rpc("missing writer handle".into()))?;
        let reader_handle = handles
            .next()
            .ok_or_else(|| LspError::Rpc("missing reader handle".into()))?;
        let stderr_handle = handles
            .next()
            .ok_or_else(|| LspError::Rpc("missing stderr handle".into()))?;

        Ok(Self {
            server_id,
            correlator,
            bus,
            outgoing,
            capabilities,
            stderr_tail,
            transport_child: transport.child,
            dispatcher,
            writer_handle,
            reader_handle,
            stderr_handle,
        })
    }

    pub async fn shutdown(self) {
        let _ = perform_shutdown(&self.correlator, &self.outgoing).await;
        let Self {
            outgoing,
            mut transport_child,
            dispatcher,
            writer_handle,
            reader_handle,
            stderr_handle,
            ..
        } = self;
        drop(outgoing);
        let _ = transport_child.kill().await;
        let _ = dispatcher.handle.await;
        let _ = writer_handle.await;
        let _ = reader_handle.await;
        let _ = stderr_handle.await;
    }

    #[must_use]
    pub fn capabilities(&self) -> Arc<ServerCapabilities> {
        self.capabilities.load_full()
    }
}
