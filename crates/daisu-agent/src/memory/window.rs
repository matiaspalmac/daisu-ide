//! Token-budget sliding window for the agent message history.
//!
//! Keeps the conversation under a target ratio of the model's context
//! while preserving (a) the first 2 messages — the original user task
//! and the model's first reply, which anchor the conversation — and
//! (b) tool_use / tool_result pairing. Anthropic, OpenAI and Gemini
//! all reject a request whose tool_result block has no matching
//! tool_use in scope, so dropping an assistant turn always cascades
//! to its associated tool messages.

use crate::provider::{Message, Role};

const KEEP_FIRST: usize = 2;
const TARGET_RATIO: f32 = 0.75;

/// Per-model context window. Falls back to a conservative default for
/// unknown identifiers (mostly local Ollama tags). Match against the
/// model id exactly the way `provider/mod.rs::default_model` does.
#[must_use]
pub fn context_window_for(model: &str) -> u32 {
    let m = model.to_ascii_lowercase();
    if m.contains("claude") {
        200_000
    } else if m.contains("gpt-5") || m.contains("o3") || m.contains("gpt-4.1") {
        400_000
    } else if m.contains("gemini") {
        1_000_000
    } else {
        // Ollama default for most chat models is 4096 unless num_ctx is
        // raised. Daisu sets num_ctx=8192 on every Ollama request.
        8_192
    }
}

/// Drop oldest messages until total tokens fit `TARGET_RATIO` of the
/// model context, while preserving the first `KEEP_FIRST` messages and
/// tool_use/tool_result pairing. Mutates in place.
pub fn slide(msgs: &mut Vec<Message>, max_context: u32) {
    // u32 → f32 narrows precision past 2^24 but max_context tops out at
    // ~10^6 in practice (1M-token frontier models), well inside f32's
    // exact-integer range.
    #[allow(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss
    )]
    let target = ((max_context as f32) * TARGET_RATIO) as u32;

    // Hard floor: never compress past KEEP_FIRST + the most recent few
    // turns. With 4 messages we always have at least one user/assistant
    // pair plus the anchors.
    while crate::memory::tokens::count_messages(msgs) > target && msgs.len() > KEEP_FIRST + 4 {
        let drop_at = KEEP_FIRST;
        let dropped = msgs.remove(drop_at);

        // Cascade: when an assistant turn with tool_calls is dropped,
        // remove its matching tool results (they have no parent now).
        if let (Role::Assistant, Some(calls)) = (dropped.role, dropped.tool_calls.as_ref()) {
            let ids: std::collections::HashSet<String> =
                calls.iter().map(|c| c.id.clone()).collect();
            msgs.retain(|m| {
                !(matches!(m.role, Role::Tool)
                    && m.tool_call_id.as_ref().is_some_and(|id| ids.contains(id)))
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::{Role, ToolCall};

    fn user(content: &str) -> Message {
        Message {
            role: Role::User,
            content: content.into(),
            tool_call_id: None,
            tool_name: None,
            tool_calls: None,
        }
    }
    fn assistant_text(content: &str) -> Message {
        Message {
            role: Role::Assistant,
            content: content.into(),
            tool_call_id: None,
            tool_name: None,
            tool_calls: None,
        }
    }
    fn assistant_with_call(id: &str) -> Message {
        Message {
            role: Role::Assistant,
            content: String::new(),
            tool_call_id: None,
            tool_name: None,
            tool_calls: Some(vec![ToolCall {
                id: id.into(),
                name: "read_file".into(),
                arguments: serde_json::json!({"path": "x"}),
            }]),
        }
    }
    fn tool_result(id: &str, content: &str) -> Message {
        Message {
            role: Role::Tool,
            content: content.into(),
            tool_call_id: Some(id.into()),
            tool_name: Some("read_file".into()),
            tool_calls: None,
        }
    }

    #[test]
    fn keeps_first_two_messages() {
        let mut msgs = vec![
            user("anchor task"),
            assistant_text("first reply"),
            user("filler".repeat(2000).as_str()),
            assistant_text("filler".repeat(2000).as_str()),
            user("filler".repeat(2000).as_str()),
            assistant_text("filler".repeat(2000).as_str()),
            user("filler".repeat(2000).as_str()),
            assistant_text("filler".repeat(2000).as_str()),
        ];
        slide(&mut msgs, 1024);
        assert_eq!(msgs[0].content, "anchor task");
        assert_eq!(msgs[1].content, "first reply");
    }

    #[test]
    fn cascades_tool_results_when_assistant_dropped() {
        let mut msgs = vec![
            user("anchor"),
            assistant_text("hi"),
            assistant_with_call("toolA"),
            tool_result("toolA", "BIG ".repeat(5000).as_str()),
            user("more".repeat(5000).as_str()),
            assistant_text("done"),
            user("anchor"),
            assistant_text("done"),
        ];
        slide(&mut msgs, 1024);
        // toolA result must not survive without its parent assistant.
        let orphan_tool = msgs
            .iter()
            .any(|m| matches!(m.role, Role::Tool) && m.tool_call_id.as_deref() == Some("toolA"));
        assert!(!orphan_tool);
    }
}
