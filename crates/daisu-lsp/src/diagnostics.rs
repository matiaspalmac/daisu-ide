//! Diagnostics cache + emission.

use std::collections::HashMap;
use std::sync::Arc;

use lsp_types::{Diagnostic, Uri};
use parking_lot::RwLock;
use serde::Serialize;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    pub uri: Uri,
    pub version: Option<i32>,
    pub server_id: String,
    pub diagnostics: Vec<Diagnostic>,
}

pub struct DiagnosticsCache {
    inner: Arc<RwLock<HashMap<(Uri, String), Vec<Diagnostic>>>>,
    tx: broadcast::Sender<DiagnosticEvent>,
}

impl Default for DiagnosticsCache {
    fn default() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
            tx,
        }
    }
}

impl DiagnosticsCache {
    pub fn ingest(&self, ev: DiagnosticEvent) {
        self.inner.write().insert(
            (ev.uri.clone(), ev.server_id.clone()),
            ev.diagnostics.clone(),
        );
        let _ = self.tx.send(ev);
    }

    #[must_use]
    pub fn for_uri(&self, uri: &Uri) -> Vec<(String, Vec<Diagnostic>)> {
        self.inner
            .read()
            .iter()
            .filter(|((u, _), _)| u == uri)
            .map(|((_, server), diags)| (server.clone(), diags.clone()))
            .collect()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<DiagnosticEvent> {
        self.tx.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_diag(line: u32) -> Diagnostic {
        Diagnostic {
            range: lsp_types::Range::new(
                lsp_types::Position::new(line, 0),
                lsp_types::Position::new(line, 1),
            ),
            message: format!("d{line}"),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn ingest_pushes_to_subscribers() {
        let cache = DiagnosticsCache::default();
        let mut rx = cache.subscribe();
        let uri: Uri = "file:///tmp/a.rs".parse().unwrap();
        cache.ingest(DiagnosticEvent {
            uri: uri.clone(),
            version: Some(1),
            server_id: "rust-analyzer".into(),
            diagnostics: vec![make_diag(0)],
        });
        let ev = rx.recv().await.unwrap();
        assert_eq!(ev.diagnostics.len(), 1);
        assert_eq!(ev.server_id, "rust-analyzer");
    }

    #[test]
    fn for_uri_returns_per_server_buckets() {
        let cache = DiagnosticsCache::default();
        let uri: Uri = "file:///tmp/a.rs".parse().unwrap();
        cache.ingest(DiagnosticEvent {
            uri: uri.clone(),
            version: None,
            server_id: "ra".into(),
            diagnostics: vec![make_diag(0)],
        });
        cache.ingest(DiagnosticEvent {
            uri: uri.clone(),
            version: None,
            server_id: "eslint".into(),
            diagnostics: vec![make_diag(1), make_diag(2)],
        });
        let mut got = cache.for_uri(&uri);
        got.sort_by_key(|(s, _)| s.clone());
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].0, "eslint");
        assert_eq!(got[0].1.len(), 2);
        assert_eq!(got[1].0, "ra");
        assert_eq!(got[1].1.len(), 1);
    }
}
