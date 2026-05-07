//! Token estimator backed by `tiktoken-rs` (`o200k_base` BPE).
//!
//! Used as a universal estimator across providers — Anthropic and Gemini
//! also use BPE so the count drifts ~10% from their wire-level
//! tokenization, which is well inside the budgeting margin we care
//! about. The provider's official `count_tokens` endpoints add 100-300ms
//! per call and are reserved for offline cost reports.

use std::sync::LazyLock;
use tiktoken_rs::{o200k_base, CoreBPE};

use crate::provider::Message;

static BPE: LazyLock<CoreBPE> =
    LazyLock::new(|| o200k_base().expect("o200k_base tokenizer initialises"));

/// Token count for a free-form string.
#[must_use]
pub fn count(text: &str) -> u32 {
    BPE.encode_with_special_tokens(text).len() as u32
}

/// Token count for one provider message including tool_calls payload.
/// Adds a small per-message overhead so empty turns don't round to 0.
#[must_use]
pub fn count_message(m: &Message) -> u32 {
    let mut n = count(&m.content) + 4;
    if let Some(calls) = &m.tool_calls {
        for c in calls {
            n += count(&c.name);
            if let Ok(s) = serde_json::to_string(&c.arguments) {
                n += count(&s);
            }
        }
    }
    if let Some(tc_id) = m.tool_call_id.as_deref() {
        n += count(tc_id);
    }
    if let Some(tn) = m.tool_name.as_deref() {
        n += count(tn);
    }
    n
}

/// Total tokens for a slice. Convenience wrapper over `count_message`.
#[must_use]
pub fn count_messages(msgs: &[Message]) -> u32 {
    msgs.iter().map(count_message).sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::Role;

    #[test]
    fn count_returns_at_least_one_for_words() {
        assert!(count("hello world") >= 2);
    }

    #[test]
    fn count_message_includes_overhead_and_tool_calls() {
        let m = Message {
            role: Role::Assistant,
            content: "ok".into(),
            tool_call_id: None,
            tool_name: None,
            tool_calls: Some(vec![crate::provider::ToolCall {
                id: "id-1".into(),
                name: "read_file".into(),
                arguments: serde_json::json!({"path": "src/main.rs"}),
            }]),
        };
        let n = count_message(&m);
        assert!(n > count("ok"));
    }
}
