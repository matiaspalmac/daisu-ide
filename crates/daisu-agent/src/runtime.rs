//! Agent runtime skeleton. Real conversation orchestration lands in
//! M3 Phase 1; this module just owns the cancellation primitive and
//! the wiring shape that downstream phases will consume.

use std::sync::Arc;

use tokio::sync::Notify;

#[derive(Debug, Default, Clone)]
pub struct CancelToken {
    inner: Arc<Notify>,
    flag: Arc<std::sync::atomic::AtomicBool>,
}

impl CancelToken {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.flag.store(true, std::sync::atomic::Ordering::SeqCst);
        self.inner.notify_waiters();
    }

    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.flag.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.inner.notified().await;
    }
}
