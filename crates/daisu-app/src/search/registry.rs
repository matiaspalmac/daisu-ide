//! Cancellation token registry keyed by `request_id`. The frontend cancels
//! in-flight searches by issuing the same `request_id`; new searches register a
//! fresh token before walking begins.

use std::collections::HashMap;
use std::sync::LazyLock;

use parking_lot::Mutex;
use tokio_util::sync::CancellationToken;

static REGISTRY: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Register a fresh cancellation token for `request_id`. Replaces any existing
/// entry (the frontend recycles ids on rare collision; older searches die).
pub fn register(request_id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    REGISTRY
        .lock()
        .insert(request_id.to_string(), token.clone());
    token
}

/// Cancel the token associated with `request_id`. No-op if absent.
pub fn cancel(request_id: &str) {
    if let Some(token) = REGISTRY.lock().get(request_id) {
        token.cancel();
    }
}

/// Remove the registry entry. Caller must call after the search completes
/// (or is cancelled) to prevent unbounded growth.
pub fn cleanup(request_id: &str) {
    REGISTRY.lock().remove(request_id);
}

#[cfg(test)]
mod tests {
    use super::{cancel, cleanup, register};

    #[test]
    fn register_returns_unique_token_per_id() {
        let a = register("registry-test-a");
        let b = register("registry-test-b");
        assert!(!a.is_cancelled());
        assert!(!b.is_cancelled());
        cleanup("registry-test-a");
        cleanup("registry-test-b");
    }

    #[test]
    fn cancel_marks_token_cancelled() {
        let token = register("registry-test-x");
        cancel("registry-test-x");
        assert!(token.is_cancelled());
        cleanup("registry-test-x");
    }

    #[test]
    fn cancel_unknown_id_is_noop() {
        cancel("does-not-exist");
    }
}
