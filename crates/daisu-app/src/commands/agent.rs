//! Tauri command bridge for the daisu-agent crate.
//!
//! Frontend talks to the agent runtime through this thin layer:
//!   - provider listing + capability discovery
//!   - per-provider key management via the OS keychain
//!   - connection test against a configured provider
//!
//! Streaming (`agent_send_message`) and persistence
//! (`agent_list_conversations`) land alongside the chat UI in
//! M3 Phase 1; this module only ships the Phase 0 surface.

#![allow(
    clippy::missing_errors_doc,
    clippy::needless_pass_by_value,
    clippy::struct_excessive_bools,
    clippy::similar_names,
    clippy::too_many_lines,
    clippy::match_same_arms,
    clippy::unused_async
)]

use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;

use daisu_agent::{
    index::{IndexStatus, Indexer, SymbolHit},
    keychain,
    memory::{ConversationSummary, MemoryStore, StoredMessage},
    permission::gate::PERMISSION_REQUEST_EVENT,
    provider::{
        anthropic::AnthropicProvider, gemini::GeminiProvider, lmstudio::LmStudioProvider,
        ollama::OllamaProvider, openai::OpenAiProvider, ProviderId, ToolCapability, ToolDef,
    },
    runtime::CancelToken,
    tools::{apply_accepted_hunks, EditHunk, ProposeEdit, ToolRegistry},
    AgentResult, AllowlistEntry, CompletionRequest, Decision, EventEmitter, LlmProvider,
    McpServerConfig, McpToolResult, Message, ModelInfo, PermissionGate, PermissionRequestEvent,
    ProviderToolCall, Role, StreamEvent, ToolCall, ToolDescriptor, ToolResult,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

use crate::commands::file_ops::{read_file_at, write_file_at};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Tauri event emitted when an MCP server connect attempt succeeds or fails.
const MCP_STATUS_EVENT: &str = "agent://mcp-status";

fn map_agent(e: daisu_agent::AgentError) -> AppError {
    AppError::Internal(format!("agent: {e}"))
}

/// Long-form default system prompt for cloud providers (Anthropic, `OpenAI`,
/// Gemini). Drawn from the May 2026 prompt research pass — fuses
/// Cursor's "only call tools when necessary" line, Lovable's "default to
/// discussion mode" pattern, and Cline's positive/negative few-shot
/// pairs. Kept under ~600 tokens so prompt-cache hits stay viable.
fn default_system_prompt_long(workspace: &str) -> String {
    format!(
        "You are Daisu, a coding assistant inside the Daisu IDE. You are \
pair-programming with the user inside their workspace at {workspace}. \
Always reply in the user's language.\n\
\n\
# Tools\n\
You have exactly four tools:\n\
- list_dir(path): list files/folders in a workspace-relative directory\n\
- read_file(path): read a workspace-relative file as UTF-8\n\
- write_file(path, contents): create or overwrite a file (workspace-relative)\n\
- propose_edit(path, new_text): propose a reviewable patch for an existing file\n\
\n\
You have no other tools. Never invent or reference tools that are not listed.\n\
\n\
# When to use tools vs. reply in chat\n\
Default to plain-text chat. Only call a tool when the user's request \
clearly needs reading, listing, writing, or editing a file in this \
workspace.\n\
\n\
CALL A TOOL when the message contains intent verbs like: open, read, show, \
look at, list, find, search, edit, change, fix, refactor, rename, create, \
write, add, implement, generate.\n\
\n\
DO NOT CALL A TOOL for: greetings (\"hi\", \"hola\"), thanks, smalltalk, \
opinions, explanations of concepts, language/library questions you can \
answer from memory, or clarifying questions back to the user.\n\
\n\
When the request is ambiguous, ask one short clarifying question instead \
of guessing. Use at most one tool per turn, then stop and wait for the \
result.\n\
\n\
# Path & safety rules\n\
All paths are workspace-relative (e.g. `src/app.ts`). Never use absolute \
roots (`/`, `C:\\`), never use `..` to escape the workspace, never touch \
`.git/`, `node_modules/`, build outputs, or files under `.daisu/`. Read a \
file before proposing an edit to it. Prefer `propose_edit` over \
`write_file` for existing files; reserve `write_file` for new files or \
full rewrites the user asked for. Never hardcode secrets. Never name \
tools to the user — say \"I'll read src/app.ts\", not \"I'll call read_file\".\n\
\n\
# Output format\n\
Reply in concise markdown. Code goes in fenced blocks with a language tag. \
Avoid filler openers like \"Certainly!\", \"Great!\", \"Sure!\". Be direct. \
Match the user's language.\n\
\n\
# Examples\n\
User: \"hola, ¿en qué andas?\"\n\
You: \"Listo para ayudarte con el código. ¿Qué querés que veamos?\"  (no tools)\n\
\n\
User: \"explain what a Rust trait is\"\n\
You: <plain-text explanation in user's locale>  (no tools)\n\
\n\
User: \"open package.json\"\n\
You: call read_file(\"package.json\")\n\
\n\
User: \"fix the typo in README\"\n\
You: call read_file(\"README.md\") — wait — then call propose_edit(...)\n"
    )
}

/// Short imperative variant for small local models (Ollama, LM Studio).
/// Strips the prose, leans on numbered rules and a short example block —
/// 3B-class models pattern-match more reliably on terse imperatives at
/// the prompt tail than on long explanations.
fn default_system_prompt_short(workspace: &str) -> String {
    format!(
        "You are Daisu, a coding assistant in the Daisu IDE. Workspace: {workspace}. \
Reply in the user's language.\n\
\n\
Tools (only these, never invent others):\n\
- list_dir(path)\n\
- read_file(path)\n\
- write_file(path, contents)\n\
- propose_edit(path, new_text)\n\
\n\
RULES:\n\
1. Default to chat. Only call a tool when the user asks to read, list, write, \
edit, open, show, find, fix, or create a file in the workspace.\n\
2. Greetings, thanks, smalltalk, concept questions: REPLY IN PLAIN TEXT, NO TOOLS.\n\
3. One tool per turn, then stop and wait.\n\
4. Paths are workspace-relative. Never use `/`, `C:\\`, or `..`. Never touch \
`.git/`, `node_modules/`, `.daisu/`.\n\
5. Read a file before editing it. Use propose_edit for existing files, \
write_file only for new files.\n\
6. Never say tool names to the user. Say \"I'll read X\", not \"I'll call read_file\".\n\
7. Be concise. No \"Certainly!\", \"Sure!\", \"Great!\". Markdown + fenced code blocks.\n\
\n\
Examples:\n\
- \"hi\" -> \"Hi! What are we building?\"  (no tool)\n\
- \"hola\" -> \"¡Hola! ¿En qué te ayudo?\"  (no tool)\n\
- \"what is a closure?\" -> explain in plain text  (no tool)\n\
- \"open src/main.rs\" -> call read_file(\"src/main.rs\")\n\
- \"rename foo to bar in utils.ts\" -> read_file then propose_edit\n"
    )
}

/// Normalise a tool name emitted by the model into the `snake_case` form
/// the registry uses. Models trained on different format families produce
/// `read_file`, `readFile`, `read-file`, `Read`, `tool.read_file`, or
/// `functions::read_file`. Without normalisation the dispatcher silently
/// drops the call. Conversion rules:
/// - strip namespace prefixes separated by `.` or `::`,
/// - kebab `-` and whitespace become `_`,
/// - `camelCase` / `PascalCase` split on uppercase boundaries,
/// - lowercased throughout.
fn normalize_tool_name(raw: &str) -> String {
    let mut s = raw.trim();
    // Strip last segment after :: or .
    if let Some(idx) = s.rfind("::") {
        s = &s[idx + 2..];
    }
    if let Some(idx) = s.rfind('.') {
        s = &s[idx + 1..];
    }
    let mut out = String::with_capacity(s.len() + 4);
    let mut prev_lower_or_digit = false;
    for c in s.chars() {
        if c == '-' || c == '_' || c.is_whitespace() {
            if !out.ends_with('_') {
                out.push('_');
            }
            prev_lower_or_digit = false;
        } else if c.is_uppercase() {
            if prev_lower_or_digit && !out.ends_with('_') {
                out.push('_');
            }
            for low in c.to_lowercase() {
                out.push(low);
            }
            prev_lower_or_digit = false;
        } else {
            out.push(c);
            prev_lower_or_digit = c.is_lowercase() || c.is_ascii_digit();
        }
    }
    // Trim trailing/leading underscores from edge cases.
    out.trim_matches('_').to_string()
}

/// Load per-workspace project rules following the AGENTS.md / CLAUDE.md
/// convergence point. Reads the first of these that exists, in this
/// order:
/// 1. `.daisu/AGENTS.md` (Daisu-native preferred)
/// 2. `AGENTS.md` (cross-tool standard adopted by Codex / Cursor / Zed
///    / Aider / 20+ others)
/// 3. `CLAUDE.md` (Anthropic Claude Code convention)
/// 4. `.cursorrules` (legacy single-file Cursor)
///
/// Returns the trimmed file contents or `None` when none of these exist.
/// Capped at 32 KiB to keep the prompt tail manageable.
fn load_workspace_rules(workspace: &std::path::Path) -> Option<String> {
    const MAX_BYTES: u64 = 32 * 1024;
    const CANDIDATES: &[&str] = &[".daisu/AGENTS.md", "AGENTS.md", "CLAUDE.md", ".cursorrules"];
    for rel in CANDIDATES {
        let p = workspace.join(rel);
        let Ok(meta) = std::fs::metadata(&p) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        if meta.len() > MAX_BYTES {
            continue;
        }
        if let Ok(s) = std::fs::read_to_string(&p) {
            let trimmed = s.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    None
}

/// Cline-style history compaction: when the same `read_file(path)` or
/// `list_dir(path)` appears multiple times in a conversation, replace
/// every Tool result *except the latest* with a small placeholder so
/// the model attends to current state and we save a chunk of context
/// per duplicate. Mutates in place. Tool args are matched by name +
/// the `path` field (not full args object) — most coding agents only
/// vary the path between reads of the same file.
fn dedupe_file_reads(messages: &mut [Message]) {
    use std::collections::HashMap;

    let mut latest_index_per_key: HashMap<(String, String), usize> = HashMap::new();
    for (i, m) in messages.iter().enumerate() {
        if !matches!(m.role, Role::Assistant) {
            continue;
        }
        let Some(calls) = m.tool_calls.as_ref() else {
            continue;
        };
        for c in calls {
            if c.name != "read_file" && c.name != "list_dir" {
                continue;
            }
            let Some(path) = c.arguments.get("path").and_then(|v| v.as_str()) else {
                continue;
            };
            latest_index_per_key.insert((c.name.clone(), path.to_string()), i);
        }
    }

    let mut redactions: Vec<(usize, String, String)> = Vec::new(); // (msg_idx, tool_id, replacement)
    for (i, m) in messages.iter().enumerate() {
        if !matches!(m.role, Role::Assistant) {
            continue;
        }
        let Some(calls) = m.tool_calls.as_ref() else {
            continue;
        };
        for c in calls {
            if c.name != "read_file" && c.name != "list_dir" {
                continue;
            }
            let Some(path) = c.arguments.get("path").and_then(|v| v.as_str()) else {
                continue;
            };
            let key = (c.name.clone(), path.to_string());
            let Some(&latest) = latest_index_per_key.get(&key) else {
                continue;
            };
            if i >= latest {
                continue;
            }
            let replacement = format!(
                "[[NOTE] {tool}({path}) deduplicated — see later result for current contents]",
                tool = c.name,
                path = path,
            );
            redactions.push((i, c.id.clone(), replacement));
        }
    }
    if redactions.is_empty() {
        return;
    }
    for (assistant_idx, tool_id, replacement) in redactions {
        for m in messages.iter_mut().skip(assistant_idx + 1) {
            if matches!(m.role, Role::Tool) && m.tool_call_id.as_deref() == Some(&tool_id) {
                m.content.clone_from(&replacement);
                break;
            }
        }
    }
}

/// Build a corrective hint string from a tool error message, used to
/// nudge small models toward the right next-call shape. Empty string
/// when no specific hint applies.
fn repair_hint_for(name: &str, args: &serde_json::Value, err: &str) -> String {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let lower = err.to_ascii_lowercase();
    if lower.contains("escapes workspace")
        || lower.contains("not allowed")
        || lower.contains("verbatim")
        || lower.contains("unc")
    {
        format!(
            "HINT: '{path}' looks absolute or escapes the workspace. \
             Use a workspace-relative path like 'src/main.rs' (no leading /, no C:\\, no '..')."
        )
    } else if lower.contains("no such file")
        || lower.contains("not found")
        || lower.contains("os error 2")
        || lower.contains("os error 3")
    {
        format!(
            "HINT: '{path}' doesn't exist. Try list_dir on the parent directory first to see real names — \
             case mismatch is common, and the model may have invented a path."
        )
    } else if name == "read_file" && lower.contains("is a directory") {
        format!(
            "HINT: '{path}' is a directory, not a file. Use list_dir for directories, read_file only for files."
        )
    } else if name == "propose_edit"
        && (lower.contains("did not match") || lower.contains("no match"))
    {
        "HINT: read_file the target first to capture the exact current contents (whitespace included), \
         then resubmit propose_edit with new_text reflecting only the wanted changes.".to_string()
    } else if name == "write_file" && lower.contains("too large") {
        "HINT: contents exceed the 1 MiB limit. Split the file or write multiple smaller files."
            .to_string()
    } else {
        String::new()
    }
}

/// Decide whether the user's message looks like chit-chat that doesn't
/// need filesystem tools. When true, the agent loop skips advertising
/// tools to the model so small local models (llama3.2:3b, qwen-coder:7b)
/// don't reflexively call `list_dir(".")` for greetings. Action verbs
/// in any of EN/ES/PT keep tools enabled.
// Action verbs that imply tool use. Match as whole words/prefixes so
// "lista" catches "listame", "listar", "list".
const ACTION_PREFIXES: &[&str] = &[
    "lee ", "leer", "lis", "list", "ver ", "muestr", "abre ", "abrir", "open ", "read ", "show ",
    "find ", "busca", "search", "grep", "escrib", "write ", "crea ", "create", "borra", "delet",
    "remove", "edita", "edit ", "modif", "run ", "ejecut", "git ", "diff", "estado", "status",
    "analiz", "analyse", "analyze", "revis", "explica", "explain", "checa", "check ",
];

fn is_conversational_opener(text: &str) -> bool {
    let lower = text.trim().to_lowercase();
    if lower.is_empty() {
        return false;
    }
    for kw in ACTION_PREFIXES {
        if lower.contains(kw) {
            return false;
        }
    }
    // Short messages without action verbs are very likely chit-chat.
    // 120 chars is generous enough to cover "hola, ¿qué puedes hacer?".
    lower.chars().count() <= 120
}

/// Recover tool calls that a non-tool-aware model emits as text instead of
/// using the wire-level `tool_calls` field. Small Ollama models (e.g.
/// `qwen2.5-coder:1.5b`, `llama3.2:3b`) ignore the `tools` parameter and
/// print a JSON object describing the call as plain text. Without this
/// fallback the agent loop terminates after the first turn and the user
/// sees the raw JSON instead of the tool result.
///
/// Recognised shapes:
/// - Fenced JSON code block: ```` ```json\n{...}\n``` ````
/// - Bare unfenced JSON object anywhere in the text
/// - Qwen3-coder XML tag: `<tool_call>{...}</tool_call>`
/// - Llama 3.1 python-tag: `<|python_tag|>{...}<|eom_id|>` (or up to EOS)
///
/// Object key tolerance: `name`/`tool`/`function` for the tool id,
/// `arguments`/`input`/`parameters` for the args object.
///
/// Calls are dropped silently if the name doesn't match a registered tool
/// — better to fall through to the "no tool calls" branch than to invent
/// dispatches the user didn't grant permission for.
///
/// Returns both the recovered calls and a `cleaned_text` with every
/// consumed JSON / XML region removed, so the chat doesn't render the
/// raw tool-call payload alongside the executed tool card.
struct FallbackParse {
    calls: Vec<ProviderToolCall>,
    cleaned_text: String,
}

fn extract_fallback_tool_calls(text: &str, registry: &Arc<ToolRegistry>) -> FallbackParse {
    let mut out = Vec::new();
    let mut consumed: Vec<(usize, usize)> = Vec::new();

    let push_call = |out: &mut Vec<ProviderToolCall>, raw: &str| -> bool {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(raw.trim()) else {
            return false;
        };
        let raw_name = v
            .get("name")
            .or_else(|| v.get("tool"))
            .or_else(|| v.get("function"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let name = normalize_tool_name(raw_name);
        if name.is_empty() || registry.get(&name).is_none() {
            return false;
        }
        let arguments = v
            .get("arguments")
            .or_else(|| v.get("input"))
            .or_else(|| v.get("parameters"))
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        out.push(ProviderToolCall {
            id: format!("fallback-{}-{name}", out.len()),
            name,
            arguments,
        });
        true
    };

    // 1) Fenced ```...``` code blocks (json/yaml language tag tolerated).
    let mut cursor = 0usize;
    while let Some(rel) = text[cursor..].find("```") {
        let after_open = cursor + rel + 3;
        let body_start = match text[after_open..].find('\n') {
            Some(n) => after_open + n + 1,
            None => break,
        };
        let Some(close_rel) = text[body_start..].find("```") else {
            break;
        };
        let body_end = body_start + close_rel;
        if push_call(&mut out, &text[body_start..body_end]) {
            consumed.push((cursor + rel, body_end + 3));
        }
        cursor = body_end + 3;
    }

    // 2) Qwen3-coder <tool_call>...</tool_call>.
    let mut cursor = 0usize;
    while let Some(rel) = text[cursor..].find("<tool_call>") {
        let body_start = cursor + rel + "<tool_call>".len();
        let Some(end_rel) = text[body_start..].find("</tool_call>") else {
            break;
        };
        let body_end = body_start + end_rel;
        if push_call(&mut out, &text[body_start..body_end]) {
            consumed.push((cursor + rel, body_end + "</tool_call>".len()));
        }
        cursor = body_end + "</tool_call>".len();
    }

    // 3) Llama 3.1 python-tag.
    if let Some(rel) = text.find("<|python_tag|>") {
        let body_start = rel + "<|python_tag|>".len();
        let body_end = text[body_start..]
            .find("<|eom_id|>")
            .or_else(|| text[body_start..].find("<|eot_id|>"))
            .map_or(text.len(), |n| body_start + n);
        if push_call(&mut out, &text[body_start..body_end]) {
            consumed.push((rel, body_end));
        }
    }

    // 4) Bare unfenced JSON. Scan for `{` and try to balance braces while
    //    respecting strings and escapes; only accept the substring if it
    //    parses, has a known tool name, and isn't nested inside a region
    //    we already consumed (avoids double-counting fenced blocks).
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'{' {
            i += 1;
            continue;
        }
        if consumed.iter().any(|(s, e)| i >= *s && i < *e) {
            i += 1;
            continue;
        }
        if let Some(end) = find_balanced_object_end(bytes, i) {
            if push_call(&mut out, &text[i..=end]) {
                consumed.push((i, end + 1));
                i = end + 1;
                continue;
            }
        }
        i += 1;
    }

    // Build a cleaned_text with the consumed regions stripped out.
    // Sort + merge overlapping ranges, then walk the source pasting
    // the gaps. Trim leftover whitespace/newlines so the chat doesn't
    // show the empty fence skeleton ("```json\n\n```").
    consumed.sort_by_key(|r| r.0);
    let mut cleaned = String::with_capacity(text.len());
    let mut cursor = 0;
    for (s, e) in &consumed {
        if *s > cursor {
            cleaned.push_str(&text[cursor..*s]);
        }
        cursor = (*e).max(cursor);
    }
    if cursor < text.len() {
        cleaned.push_str(&text[cursor..]);
    }
    let cleaned_text = collapse_blank_runs(cleaned.trim());

    FallbackParse {
        calls: out,
        cleaned_text,
    }
}

/// Collapse runs of 3+ newlines (and whitespace-only lines between them)
/// down to a single blank line. After stripping fenced JSON blocks the
/// surrounding prose often has dangling empties; this keeps the chat
/// transcript readable.
fn collapse_blank_runs(s: &str) -> String {
    // Drop blank lines entirely so the prose around a consumed tool-call
    // block reads as one paragraph instead of inheriting the vertical
    // gap that the fenced JSON used to occupy. Non-blank lines join with
    // a single newline.
    let mut out = String::with_capacity(s.len());
    for line in s.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(line);
    }
    out
}

/// Walk a byte slice starting at an opening `{` and return the index of
/// its matching `}`. Tracks string literals and `\` escapes so braces
/// inside JSON strings don't count. Returns None on EOF inside a string
/// or unbalanced input — matches the "ignore malformed tail" policy of
/// the fallback parser.
fn find_balanced_object_end(bytes: &[u8], start: usize) -> Option<usize> {
    debug_assert!(bytes[start] == b'{');
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    let mut i = start;
    while i < bytes.len() {
        let c = bytes[i];
        if in_string {
            if escaped {
                escaped = false;
            } else if c == b'\\' {
                escaped = true;
            } else if c == b'"' {
                in_string = false;
            }
        } else {
            match c {
                b'"' => in_string = true,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(i);
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod fallback_parser_tests {
    use super::*;
    use daisu_agent::tools::ToolRegistry;

    fn registry() -> Arc<ToolRegistry> {
        Arc::new(ToolRegistry::default())
    }

    #[test]
    fn fenced_json_write_file() {
        let text = "Sure thing!\n```json\n{\"name\": \"write_file\", \"arguments\": {\"path\": \"a.md\", \"contents\": \"hi\"}}\n```";
        let res = extract_fallback_tool_calls(text, &registry());
        assert_eq!(res.calls.len(), 1);
        assert_eq!(res.calls[0].name, "write_file");
        assert_eq!(res.calls[0].arguments["path"], "a.md");
        assert_eq!(res.cleaned_text, "Sure thing!");
    }

    #[test]
    fn unfenced_json_object() {
        let text = "Voy a listar:\n{\"name\": \"list_dir\", \"arguments\": {\"path\": \".\"}}\n";
        let res = extract_fallback_tool_calls(text, &registry());
        assert_eq!(res.calls.len(), 1);
        assert_eq!(res.calls[0].name, "list_dir");
        assert_eq!(res.cleaned_text, "Voy a listar:");
    }

    #[test]
    fn qwen3_xml_tag() {
        let text =
            "<tool_call>{\"name\": \"read_file\", \"arguments\": {\"path\": \"x\"}}</tool_call>";
        let res = extract_fallback_tool_calls(text, &registry());
        assert_eq!(res.calls.len(), 1);
        assert_eq!(res.calls[0].name, "read_file");
    }

    #[test]
    fn llama3_python_tag() {
        let text =
            "<|python_tag|>{\"name\": \"list_dir\", \"parameters\": {\"path\": \".\"}}<|eom_id|>";
        let res = extract_fallback_tool_calls(text, &registry());
        assert_eq!(res.calls.len(), 1);
        assert_eq!(res.calls[0].name, "list_dir");
    }

    #[test]
    fn ignores_unknown_tool_name() {
        let text = "{\"name\": \"nuke_disk\", \"arguments\": {}}";
        let res = extract_fallback_tool_calls(text, &registry());
        assert!(res.calls.is_empty());
        // Unknown names leave the original text intact — the user still
        // sees what the model wrote.
        assert_eq!(res.cleaned_text, text);
    }

    #[test]
    fn ignores_plain_json_without_name() {
        let text = "config: {\"path\": \"x\", \"contents\": \"hi\"}";
        let res = extract_fallback_tool_calls(text, &registry());
        assert!(res.calls.is_empty());
    }

    #[test]
    fn dedupes_fenced_and_bare() {
        // The same call inside a fence shouldn't be picked up twice by the
        // bare-JSON pass.
        let text = "```json\n{\"name\": \"list_dir\", \"arguments\": {\"path\": \".\"}}\n```";
        let res = extract_fallback_tool_calls(text, &registry());
        assert_eq!(res.calls.len(), 1);
        assert_eq!(res.cleaned_text, "");
    }

    #[test]
    fn handles_braces_inside_strings() {
        let text =
            "{\"name\": \"write_file\", \"arguments\": {\"path\": \"a.md\", \"contents\": \"x{y}z\"}}";
        let res = extract_fallback_tool_calls(text, &registry());
        assert_eq!(res.calls.len(), 1);
        assert_eq!(res.calls[0].arguments["contents"], "x{y}z");
    }

    #[test]
    fn cleans_text_around_consumed_block() {
        let text = "Sure! Here's the file:\n```json\n{\"name\": \"write_file\", \"arguments\": {\"path\": \"a.md\", \"contents\": \"hi\"}}\n```\nLet me know!";
        let res = extract_fallback_tool_calls(text, &registry());
        assert_eq!(res.calls.len(), 1);
        assert_eq!(res.cleaned_text, "Sure! Here's the file:\nLet me know!");
    }
}

/// Build the `ToolDef` list the LLM sees from the static tool registry.
/// Parses each tool's `input_schema` JSON literal once per request.
///
/// Currently sources from `daisu_agent::tools::registry()` directly —
/// the runtime `ToolRegistry` is taken as a parameter so the signature
/// is stable when the registry becomes configurable (per-workspace
/// tool sets, MCP-injected tools), but for now both paths produce the
/// same set. A schema parse failure is logged via `eprintln!` rather
/// than silently degrading; the literal is a compile-time string so
/// any failure is a programmer error worth surfacing in dev builds.
fn tool_defs_from_registry(registry: &ToolRegistry) -> Vec<ToolDef> {
    registry
        .descriptors()
        .into_iter()
        .map(|d| {
            let input_schema = serde_json::from_str(d.input_schema).unwrap_or_else(|err| {
                eprintln!(
                    "agent: invalid input_schema for tool {} — {err}; falling back to empty object",
                    d.name
                );
                serde_json::json!({"type":"object"})
            });
            ToolDef {
                name: d.name.to_string(),
                description: Some(d.description.to_string()),
                input_schema,
                // All in-tree tools opt into strict mode — schemas in
                // `tools::registry()` already carry `additionalProperties:
                // false` and every property in `required`. Providers that
                // don't expose strict (Gemini, Ollama, LM Studio) ignore
                // this flag. MCP-injected tools default to strict=false
                // since their schemas come from third parties.
                strict: true,
            }
        })
        .collect()
}

/// Translate a stored row back into the in-memory provider message
/// shape, including any persisted `tool_calls` JSON.
fn stored_to_message(m: StoredMessage) -> Message {
    let role = match m.role.as_str() {
        "user" => Role::User,
        "assistant" => Role::Assistant,
        "tool" => Role::Tool,
        "system" => Role::System,
        _ => Role::User,
    };
    let tool_calls = m
        .tool_calls_json
        .as_deref()
        .filter(|s| !s.is_empty())
        .and_then(|s| serde_json::from_str::<Vec<ProviderToolCall>>(s).ok());
    Message {
        role,
        content: m.content,
        tool_call_id: m.tool_call_id,
        tool_name: m.tool_name,
        tool_calls,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub requires_key: bool,
    pub has_key: bool,
    pub supports_tools: bool,
    pub supports_parallel_tools: bool,
    pub implemented: bool,
    /// Suggested model id for new conversations. UI pre-selects this in
    /// the dropdown; users can pick anything from the live catalog.
    /// Empty string means "no static default" (LM Studio — depends on
    /// what's loaded).
    pub default_model: String,
}

#[tauri::command]
pub async fn agent_provider_list() -> AppResult<Vec<ProviderInfo>> {
    // Single source of truth: capabilities, display names, and default
    // models all flow from `ProviderId` into both the trait impls and
    // this metadata response. No drift possible.
    let ids = [
        ProviderId::Ollama,
        ProviderId::Anthropic,
        ProviderId::OpenAi,
        ProviderId::Gemini,
        ProviderId::LmStudio,
    ];

    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        let requires_key = id.requires_key();
        let has_key = if requires_key {
            tokio::task::spawn_blocking(move || keychain::has_key(id.as_str()))
                .await
                .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
                .map_err(map_agent)?
        } else {
            true
        };
        let caps: ToolCapability = id.capabilities();
        out.push(ProviderInfo {
            id: id.as_str().into(),
            name: id.display_name().into(),
            requires_key,
            has_key,
            supports_tools: caps.function_calls,
            supports_parallel_tools: caps.parallel_calls,
            // All five providers ship full implementations as of M3 Phase 1.
            implemented: true,
            default_model: id.default_model().to_string(),
        });
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelsRequest {
    pub provider: String,
    #[serde(default)]
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelsResponse {
    pub models: Vec<ModelInfo>,
    pub default_model: String,
}

#[tauri::command]
pub async fn agent_provider_models(
    req: ProviderModelsRequest,
) -> AppResult<ProviderModelsResponse> {
    let provider = build_provider(&req.provider, req.base_url.as_deref()).await?;
    let default_model = provider.default_model().to_string();
    let models = provider.list_models().await.map_err(map_agent)?;
    Ok(ProviderModelsResponse {
        models,
        default_model,
    })
}

#[tauri::command]
pub async fn agent_key_set(provider: String, secret: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || keychain::set_key(&provider, &secret))
        .await
        .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
        .map_err(map_agent)
}

#[tauri::command]
pub async fn agent_key_clear(provider: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || keychain::clear_key(&provider))
        .await
        .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
        .map_err(map_agent)
}

#[tauri::command]
pub async fn agent_key_has(provider: String) -> AppResult<bool> {
    tokio::task::spawn_blocking(move || keychain::has_key(&provider))
        .await
        .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
        .map_err(map_agent)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestRequest {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResponse {
    pub ok: bool,
    pub model: String,
    pub sample: String,
    pub latency_ms: u128,
}

#[tauri::command]
pub async fn agent_provider_test(req: ProviderTestRequest) -> AppResult<ProviderTestResponse> {
    let started = std::time::Instant::now();
    let provider = build_provider(&req.provider, req.base_url.as_deref()).await?;

    // LM Studio (and any provider with no static default) needs a real
    // model id to talk to — pulling the first one off `list_models`
    // lets the user hit "Test connection" without manually selecting a
    // model first.
    let model = if req.model.is_empty() {
        let models = provider.list_models().await.map_err(map_agent)?;
        models
            .into_iter()
            .next()
            .map(|m| m.id)
            .ok_or_else(|| AppError::Internal("no models available on this endpoint".into()))?
    } else {
        req.model.clone()
    };

    let completion_req = CompletionRequest {
        model: model.clone(),
        messages: vec![Message {
            role: Role::User,
            content: "Say the single word 'ok'.".into(),
            tool_call_id: None,
            tool_name: None,
            tool_calls: None,
        }],
        system: None,
        tools: Vec::new(),
        tool_choice: None,
        max_tokens: 32,
        temperature: Some(0.0),
    };

    let resp = provider.complete(completion_req).await.map_err(map_agent)?;
    Ok(ProviderTestResponse {
        ok: true,
        model: resp.model,
        sample: resp.content,
        latency_ms: started.elapsed().as_millis(),
    })
}

async fn build_provider(provider: &str, base_url: Option<&str>) -> AppResult<Box<dyn LlmProvider>> {
    match provider {
        "ollama" => {
            let url = base_url.unwrap_or("http://localhost:11434").to_string();
            let p = OllamaProvider::new(url).map_err(map_agent)?;
            Ok(Box::new(p))
        }
        "anthropic" => {
            let key = load_key("anthropic").await?;
            let p = AnthropicProvider::new(key).map_err(map_agent)?;
            Ok(Box::new(p))
        }
        "openai" => {
            let key = load_key("openai").await?;
            let p = OpenAiProvider::new(key).map_err(map_agent)?;
            Ok(Box::new(p))
        }
        "gemini" => {
            let key = load_key("gemini").await?;
            let p = GeminiProvider::new(key).map_err(map_agent)?;
            Ok(Box::new(p))
        }
        "lmstudio" => {
            let url = base_url.unwrap_or("http://localhost:1234/v1").to_string();
            let p = LmStudioProvider::new(url).map_err(map_agent)?;
            Ok(Box::new(p))
        }
        other => Err(AppError::Internal(format!("unknown provider: {other}"))),
    }
}

// ─── M3 Phase 2: tool dispatcher + permission gate ───────────────────

/// Tauri-backed event emitter that the agent crate uses to push
/// permission requests to the frontend. Keeps `daisu-agent` Tauri-free.
struct TauriEmitter {
    handle: tauri::AppHandle,
}

impl EventEmitter for TauriEmitter {
    fn emit(&self, event: &str, payload: &PermissionRequestEvent) -> Result<(), String> {
        self.handle.emit(event, payload).map_err(|e| e.to_string())
    }
}

fn workspace_db_path(workspace: &std::path::Path) -> PathBuf {
    workspace.join(".daisu").join("agent.db")
}

/// Validate that the workspace path the frontend sent is an existing
/// directory and canonicalise it before any IO. Rejects symlink games
/// and non-existent paths so `MemoryStore::open` never gets handed a
/// crafted location outside the user's real filesystem.
fn validate_workspace(raw: &str) -> AppResult<PathBuf> {
    if raw.trim().is_empty() {
        return Err(AppError::Internal("empty workspace path".into()));
    }
    let candidate = PathBuf::from(raw);
    let canonical = candidate
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("workspace canonicalize: {e}")))?;
    if !canonical.is_dir() {
        return Err(AppError::Internal(format!(
            "workspace is not a directory: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
}

fn gate_for_workspace(
    state: &AppState,
    handle: &tauri::AppHandle,
    workspace: &std::path::Path,
) -> AppResult<Arc<PermissionGate>> {
    let mut gates = state.permission_gates.lock();
    if let Some(existing) = gates.get(workspace) {
        return Ok(existing.clone());
    }
    let store =
        daisu_agent::memory::MemoryStore::open(workspace_db_path(workspace)).map_err(map_agent)?;
    let emitter: Arc<dyn EventEmitter> = Arc::new(TauriEmitter {
        handle: handle.clone(),
    });
    let gate = Arc::new(PermissionGate::new(Arc::new(store), emitter));
    gates.insert(workspace.to_path_buf(), gate.clone());
    Ok(gate)
}

#[tauri::command]
#[must_use]
pub fn agent_tool_list(state: State<'_, AppState>) -> Vec<ToolDescriptor> {
    state.tool_registry.descriptors()
}

// -- MCP commands -----------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatusInfo {
    pub name: String,
    pub connected: bool,
    pub tool_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub server: String,
    pub name: String,
    pub description: Option<String>,
    pub schema: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectRequest {
    pub config: McpServerConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDisconnectRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpListToolsRequest {
    #[serde(default)]
    pub server_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallToolRequest {
    pub server: String,
    pub tool: String,
    #[serde(default = "default_args")]
    pub arguments: serde_json::Value,
}

fn default_args() -> serde_json::Value {
    serde_json::json!({})
}

#[tauri::command]
pub async fn agent_mcp_connect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: McpConnectRequest,
) -> AppResult<McpStatusInfo> {
    let registry = state.mcp_registry.clone();
    let name = req.config.name.clone();
    match registry.connect(req.config).await {
        Ok(client) => {
            let status = client.status().await;
            let _ = app.emit(
                MCP_STATUS_EVENT,
                serde_json::json!({ "name": name, "ok": true }),
            );
            Ok(McpStatusInfo {
                name: status.name,
                connected: status.connected,
                tool_count: status.tool_count,
            })
        }
        Err(e) => {
            let msg = e.to_string();
            let _ = app.emit(
                MCP_STATUS_EVENT,
                serde_json::json!({ "name": name, "ok": false, "error": msg }),
            );
            Err(map_agent(e))
        }
    }
}

#[tauri::command]
pub async fn agent_mcp_disconnect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: McpDisconnectRequest,
) -> AppResult<bool> {
    let removed = state.mcp_registry.disconnect(&req.name).await;
    if removed {
        let _ = app.emit(
            MCP_STATUS_EVENT,
            serde_json::json!({
                "name": req.name,
                "ok": true,
                "connected": false,
                "event": "disconnected",
            }),
        );
    }
    Ok(removed)
}

#[tauri::command]
pub async fn agent_mcp_status(state: State<'_, AppState>) -> AppResult<Vec<McpStatusInfo>> {
    Ok(state
        .mcp_registry
        .statuses()
        .await
        .into_iter()
        .map(|s| McpStatusInfo {
            name: s.name,
            connected: s.connected,
            tool_count: s.tool_count,
        })
        .collect())
}

#[tauri::command]
pub async fn agent_mcp_list_tools(
    state: State<'_, AppState>,
    req: McpListToolsRequest,
) -> AppResult<Vec<McpToolInfo>> {
    let all = state.mcp_registry.tools().await;
    let filtered: Vec<McpToolInfo> = all
        .into_iter()
        .filter(|(server, _)| {
            req.server_name
                .as_ref()
                .is_none_or(|filter| filter == server)
        })
        .map(|(server, tool)| McpToolInfo {
            server,
            name: tool.name,
            description: tool.description,
            schema: tool.input_schema,
        })
        .collect();
    Ok(filtered)
}

#[tauri::command]
pub async fn agent_mcp_call_tool(
    state: State<'_, AppState>,
    req: McpCallToolRequest,
) -> AppResult<McpToolResult> {
    let client =
        state.mcp_registry.get(&req.server).await.ok_or_else(|| {
            AppError::Internal(format!("mcp server not connected: {}", req.server))
        })?;
    client
        .call_tool(&req.tool, req.arguments)
        .await
        .map_err(map_agent)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDispatchRequest {
    pub tool: String,
    pub arguments: serde_json::Value,
    pub scope: String,
    pub workspace_path: String,
}

#[tauri::command]
pub async fn agent_tool_dispatch(
    handle: tauri::AppHandle,
    req: ToolDispatchRequest,
) -> AppResult<ToolResult> {
    let workspace = validate_workspace(&req.workspace_path)?;
    let state = handle.state::<AppState>();
    let gate = gate_for_workspace(&state, &handle, &workspace)?;
    let registry = state.tool_registry.clone();
    let call = ToolCall {
        name: req.tool,
        arguments: req.arguments,
    };
    Ok(registry.dispatch(call, &gate, &workspace, &req.scope).await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResolveRequest {
    pub workspace_path: String,
    pub request_id: String,
    pub decision: Decision,
}

#[tauri::command]
pub fn agent_permission_resolve(
    handle: tauri::AppHandle,
    req: PermissionResolveRequest,
) -> AppResult<bool> {
    let state = handle.state::<AppState>();
    let workspace = validate_workspace(&req.workspace_path)?;
    let gate = gate_for_workspace(&state, &handle, &workspace)?;
    Ok(gate.resolve(&req.request_id, req.decision))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowlistListRequest {
    pub workspace_path: String,
}

#[tauri::command]
pub fn agent_permission_list_allowlist(
    handle: tauri::AppHandle,
    req: AllowlistListRequest,
) -> AppResult<Vec<AllowlistEntry>> {
    let state = handle.state::<AppState>();
    let workspace = validate_workspace(&req.workspace_path)?;
    let gate = gate_for_workspace(&state, &handle, &workspace)?;
    gate.list_allowlist().map_err(map_agent)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowlistClearRequest {
    pub workspace_path: String,
    pub tool_name: Option<String>,
}

#[tauri::command]
pub fn agent_permission_clear_allowlist(
    handle: tauri::AppHandle,
    req: AllowlistClearRequest,
) -> AppResult<usize> {
    let state = handle.state::<AppState>();
    let workspace = validate_workspace(&req.workspace_path)?;
    let gate = gate_for_workspace(&state, &handle, &workspace)?;
    gate.clear_allowlist(req.tool_name.as_deref())
        .map_err(map_agent)
}

/// Re-export of the event name so `lib.rs` can use it without
/// reaching into `daisu-agent` internals.
pub const PERMISSION_REQUEST_EVENT_NAME: &str = PERMISSION_REQUEST_EVENT;

// ----------------------------------------------------------------------------
// Conversations + streaming (M3 Phase 1)
// ----------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationRequest {
    pub workspace_path: String,
    pub title: String,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationResponse {
    pub id: String,
}

fn store_for(state: &State<'_, AppState>, workspace: &str) -> AppResult<Arc<MemoryStore>> {
    state
        .agent_memory(&PathBuf::from(workspace))
        .map_err(AppError::Internal)
}

#[tauri::command]
pub async fn agent_create_conversation(
    state: State<'_, AppState>,
    req: CreateConversationRequest,
) -> AppResult<CreateConversationResponse> {
    let store = store_for(&state, &req.workspace_path)?;
    let id = tokio::task::spawn_blocking(move || {
        store.create_conversation(&req.title, &req.provider, &req.model)
    })
    .await
    .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
    .map_err(map_agent)?;
    Ok(CreateConversationResponse { id })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListConversationsRequest {
    pub workspace_path: String,
}

#[tauri::command]
pub async fn agent_list_conversations(
    state: State<'_, AppState>,
    req: ListConversationsRequest,
) -> AppResult<Vec<ConversationSummary>> {
    let store = store_for(&state, &req.workspace_path)?;
    tokio::task::spawn_blocking(move || store.list_conversations())
        .await
        .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
        .map_err(map_agent)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetMessagesRequest {
    pub workspace_path: String,
    pub conversation_id: String,
}

#[tauri::command]
pub async fn agent_get_messages(
    state: State<'_, AppState>,
    req: GetMessagesRequest,
) -> AppResult<Vec<StoredMessage>> {
    let store = store_for(&state, &req.workspace_path)?;
    tokio::task::spawn_blocking(move || store.get_messages(&req.conversation_id))
        .await
        .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
        .map_err(map_agent)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteConversationRequest {
    pub workspace_path: String,
    pub conversation_id: String,
}

#[tauri::command]
pub async fn agent_delete_conversation(
    state: State<'_, AppState>,
    req: DeleteConversationRequest,
) -> AppResult<()> {
    let store = store_for(&state, &req.workspace_path)?;
    tokio::task::spawn_blocking(move || store.delete_conversation(&req.conversation_id))
        .await
        .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
        .map_err(map_agent)
}

/// Conversation mode the user picked in the composer. Drives whether
/// tools are advertised, which subset, and what system prompt addendum
/// is appended. Default is `Auto` — keep the May 2026 heuristic that
/// strips tools for greetings while leaving them on for action verbs.
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChatMode {
    /// Pure chat. Tools are never advertised; the model answers in text.
    Chat,
    /// Full agent. All tools available; heuristic disabled.
    Agent,
    /// Plan-first: read-only tools advertised; the model is asked to
    /// produce a plan before any side-effect call.
    Plan,
    /// Default. Honour the conversational-opener heuristic.
    #[default]
    #[serde(other)]
    Auto,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    pub workspace_path: String,
    pub conversation_id: String,
    pub user_text: String,
    pub system_prompt: Option<String>,
    pub base_url: Option<String>,
    pub temperature: Option<f32>,
    #[serde(default)]
    pub chat_mode: ChatMode,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageResponse {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
enum StreamPayload {
    Started {
        run_id: String,
        conversation_id: String,
    },
    Delta {
        run_id: String,
        text: String,
    },
    /// Replace the entire accumulated text for the active assistant turn.
    /// Emitted when the fallback parser strips a tool-call payload from
    /// the streamed text so the chat UI can re-render with the cleaned
    /// version instead of the raw JSON the model emitted.
    ReplaceText {
        run_id: String,
        text: String,
    },
    Warning {
        run_id: String,
        message: String,
    },
    /// Model wants to call a tool. UI renders a collapsible block.
    ToolUseStart {
        run_id: String,
        id: String,
        name: String,
    },
    ToolUseArgsDelta {
        run_id: String,
        id: String,
        fragment: String,
    },
    ToolUseDone {
        run_id: String,
        id: String,
    },
    /// Tool dispatch finished. `ok` reflects whether the dispatcher
    /// returned a result vs an error vs a denial.
    ToolResult {
        run_id: String,
        id: String,
        name: String,
        ok: bool,
        output: serde_json::Value,
    },
    Done {
        run_id: String,
        message_id: String,
    },
    Error {
        run_id: String,
        message: String,
    },
    Cancelled {
        run_id: String,
    },
}

const STREAM_EVENT: &str = "agent://stream";

/// Cap on agentic iterations (provider call + tool dispatch counts as 1).
/// Prevents a runaway loop with a misbehaving model — if the model keeps
/// asking for more tools forever, we bail with an error after this many
/// turns rather than burning tokens indefinitely.
const MAX_AGENT_ITERATIONS: u32 = 10;

#[tauri::command]
pub async fn agent_send_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: SendMessageRequest,
) -> AppResult<SendMessageResponse> {
    let store = store_for(&state, &req.workspace_path)?;
    let run_id = Uuid::new_v4().to_string();
    let cancel = CancelToken::new();
    state.register_agent_run(run_id.clone(), cancel.clone());

    let convo = {
        let store_c = store.clone();
        let cid = req.conversation_id.clone();
        tokio::task::spawn_blocking(move || store_c.get_conversation(&cid))
            .await
            .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
            .map_err(map_agent)?
            .ok_or_else(|| AppError::Internal("conversation not found".into()))?
    };

    // Persist user turn before kicking off the stream so a crash mid-stream
    // doesn't lose the user's input.
    let user_msg = Message {
        role: Role::User,
        content: req.user_text.clone(),
        tool_call_id: None,
        tool_name: None,
        tool_calls: None,
    };
    {
        let store_c = store.clone();
        let user_msg = user_msg.clone();
        let cid = req.conversation_id.clone();
        tokio::task::spawn_blocking(move || store_c.append_message(&cid, &user_msg, None))
            .await
            .map_err(|e| AppError::Internal(format!("agent join: {e}")))?
            .map_err(map_agent)?;
    }

    // Pre-resolve workspace + permission gate once so the spawned loop
    // can dispatch tools without re-validating per iteration.
    let workspace = validate_workspace(&req.workspace_path)?;
    let gate = gate_for_workspace(&state, &app, &workspace)?;
    let tool_registry = state.tool_registry.clone();

    let provider = build_provider(&convo.provider, req.base_url.as_deref()).await?;
    let all_tools = tool_defs_from_registry(&state.tool_registry);
    // Conversational opener heuristic: small local models (llama3.2:3b,
    // qwen2.5-coder:1.5b) call tools for greetings even when the system
    // prompt forbids it. Strip tools entirely when the user's first turn
    // looks like chit-chat so the model is forced to answer in text.
    // Cheap and reversible — once the user asks for an action, the tool
    // list comes back automatically on the next message.
    // Chat-mode resolution. Explicit user mode (Chat/Agent/Plan) wins
    // over the auto heuristic. Auto preserves the May 2026 behaviour:
    // strip tools for greetings, full catalog otherwise.
    let convo_provider_is_ollama = convo.provider == "ollama";
    let conversational_opener = is_conversational_opener(&req.user_text);
    let mode_strips_tools = match req.chat_mode {
        ChatMode::Chat => true,
        ChatMode::Agent => false,
        ChatMode::Plan => false, // Plan keeps read-only tools, see below.
        ChatMode::Auto => conversational_opener,
    };
    let tool_choice = if mode_strips_tools {
        Some(daisu_agent::provider::ToolChoice::None)
    } else {
        None
    };
    // Tool curation per mode:
    // - Chat: drop everything. Ollama ignores tool_choice anyway, and on
    //   cloud providers tool_choice=None already prevents calls.
    // - Plan: only Auto-tier (read-only) tools. Hides write_file /
    //   propose_edit so the model has to discuss before doing.
    // - Agent / Auto: full catalogue. For Auto we still strip on Ollama
    //   when the message looks conversational, since the daemon ignores
    //   tool_choice and would otherwise tool-spam.
    let tools = match req.chat_mode {
        ChatMode::Chat => Vec::new(),
        ChatMode::Plan => all_tools
            .into_iter()
            .filter(|t| matches!(t.name.as_str(), "read_file" | "list_dir"))
            .collect(),
        ChatMode::Agent => all_tools,
        ChatMode::Auto => {
            if conversational_opener && convo_provider_is_ollama {
                Vec::new()
            } else {
                all_tools
            }
        }
    };
    // Inject a default system prompt when the frontend doesn't send one.
    // We pick one of two variants based on the provider class: cloud
    // models (Anthropic/OpenAI/Gemini) get the long version with full
    // few-shot, since their context window is generous and they
    // generalise better from positive+negative examples. Local models
    // (Ollama, LM Studio) get a tight imperative variant — small models
    // attend more reliably to short rules at the prompt tail than to
    // verbose prose. Both variants share tool semantics so chat history
    // stays portable across providers.
    let mut system_prompt = req.system_prompt.clone().or_else(|| {
        let workspace_str = workspace.display().to_string();
        Some(
            if convo_provider_is_ollama || convo.provider == "lmstudio" {
                default_system_prompt_short(&workspace_str)
            } else {
                default_system_prompt_long(&workspace_str)
            },
        )
    });
    // Mode-specific prompt addenda. Kept short — appended at the end of
    // the system prompt where small models attend most strongly.
    if let Some(ref mut sp) = system_prompt {
        match req.chat_mode {
            ChatMode::Chat => sp.push_str(
                "\n\n# Mode: CHAT\nYou are in chat-only mode. Do not call any tool. \
Answer in plain text only.",
            ),
            ChatMode::Plan => sp.push_str(
                "\n\n# Mode: PLAN\nYou may only inspect the workspace (list_dir, \
read_file). You CANNOT write or edit files in this turn. Produce a \
short, numbered plan describing what you would do, then ask the user \
to confirm before switching to Agent mode.",
            ),
            ChatMode::Agent => sp.push_str(
                "\n\n# Mode: AGENT\nFull tool access. Execute the user's request \
end-to-end. Still keep one tool per turn and ask for clarification \
when the request is ambiguous.",
            ),
            ChatMode::Auto => {}
        }
    }
    // Per-workspace project rules. Honour the AGENTS.md / CLAUDE.md
    // emerging convention by reading whichever of these is present at
    // the workspace root and appending to the system prompt. Workspace
    // rules go AFTER defaults — small models attend most strongly to
    // the prompt tail so user content gets the priority real estate.
    if let Some(ref mut sp) = system_prompt {
        if let Some(rules) = load_workspace_rules(&workspace) {
            sp.push_str("\n\n# Project rules (from workspace)\n");
            sp.push_str(&rules);
        }
    }
    let temperature = req.temperature;

    let app_handle = app.clone();
    let run_id_bg = run_id.clone();
    let convo_id = req.conversation_id.clone();
    let model = convo.model.clone();
    let scope_default = workspace.display().to_string();

    tokio::spawn(async move {
        let _ = app_handle.emit(
            STREAM_EVENT,
            StreamPayload::Started {
                run_id: run_id_bg.clone(),
                conversation_id: convo_id.clone(),
            },
        );

        let mut last_message_id = String::new();
        let mut iteration: u32 = 0;
        let mut error: Option<String> = None;
        let mut cancelled = false;

        // Load history once before the loop. Each iteration mutates the
        // in-memory buffer (push assistant turn, push tool messages) in
        // lock-step with persistence so we never re-deserialise the same
        // SQLite rows on a multi-step tool chase. ~50ms × MAX_ITER saved
        // on the hot path.
        let history_load = {
            let store_c = store.clone();
            let cid = convo_id.clone();
            tokio::task::spawn_blocking(move || store_c.get_messages(&cid)).await
        };
        let mut messages: Vec<Message> = match history_load {
            Ok(Ok(h)) => h
                .into_iter()
                .filter(|m| m.role != "system")
                .map(stored_to_message)
                .collect(),
            Ok(Err(e)) => {
                error = Some(format!("history: {e}"));
                Vec::new()
            }
            Err(e) => {
                error = Some(format!("history join: {e}"));
                Vec::new()
            }
        };

        while iteration < MAX_AGENT_ITERATIONS && error.is_none() {
            iteration += 1;

            // Compact history before the provider call. Cheap, pure, and
            // shrinks tool-heavy conversations 30-60% on average. Then
            // slide the window if total tokens exceed the model's
            // context target — tool_use/tool_result pairing preserved.
            let mut compacted = messages.clone();
            dedupe_file_reads(&mut compacted);
            let ctx = daisu_agent::memory::window::context_window_for(&model);
            daisu_agent::memory::window::slide(&mut compacted, ctx);

            let completion = CompletionRequest {
                model: model.clone(),
                messages: compacted,
                system: system_prompt.clone(),
                max_tokens: 4096,
                temperature,
                tools: tools.clone(),
                tool_choice,
            };

            let mut stream = provider.stream(completion);
            let mut accumulated_text = String::new();
            let mut emitted_tool_calls: Vec<ProviderToolCall> = Vec::new();

            'inner: loop {
                tokio::select! {
                    () = cancel.cancelled() => {
                        cancelled = true;
                        break 'inner;
                    }
                    next = stream.next() => {
                        match next {
                            Some(Ok(StreamEvent::Delta { text })) => {
                                accumulated_text.push_str(&text);
                                let _ = app_handle.emit(
                                    STREAM_EVENT,
                                    StreamPayload::Delta {
                                        run_id: run_id_bg.clone(),
                                        text,
                                    },
                                );
                            }
                            Some(Ok(StreamEvent::ToolUseStart { id, name })) => {
                                let _ = app_handle.emit(
                                    STREAM_EVENT,
                                    StreamPayload::ToolUseStart {
                                        run_id: run_id_bg.clone(),
                                        id,
                                        name,
                                    },
                                );
                            }
                            Some(Ok(StreamEvent::ToolUseArgsDelta { id, fragment })) => {
                                let _ = app_handle.emit(
                                    STREAM_EVENT,
                                    StreamPayload::ToolUseArgsDelta {
                                        run_id: run_id_bg.clone(),
                                        id,
                                        fragment,
                                    },
                                );
                            }
                            Some(Ok(StreamEvent::ToolUseDone { id })) => {
                                let _ = app_handle.emit(
                                    STREAM_EVENT,
                                    StreamPayload::ToolUseDone {
                                        run_id: run_id_bg.clone(),
                                        id,
                                    },
                                );
                            }
                            Some(Ok(StreamEvent::Warning { message })) => {
                                let _ = app_handle.emit(
                                    STREAM_EVENT,
                                    StreamPayload::Warning {
                                        run_id: run_id_bg.clone(),
                                        message,
                                    },
                                );
                            }
                            Some(Ok(StreamEvent::Done { tool_calls, .. })) => {
                                emitted_tool_calls = tool_calls;
                                break 'inner;
                            }
                            None => break 'inner,
                            Some(Err(e)) => {
                                error = Some(format!("{e}"));
                                break 'inner;
                            }
                        }
                    }
                }
            }

            if cancelled || error.is_some() {
                // Persist partial text before bailing so the user keeps it.
                if !accumulated_text.is_empty() {
                    let msg = Message {
                        role: Role::Assistant,
                        content: accumulated_text,
                        tool_call_id: None,
                        tool_name: None,
                        tool_calls: if emitted_tool_calls.is_empty() {
                            None
                        } else {
                            Some(emitted_tool_calls.clone())
                        },
                    };
                    let store_c = store.clone();
                    let cid = convo_id.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        store_c.append_message(&cid, &msg, None)
                    })
                    .await;
                }
                break;
            }

            // Fallback for non-tool-aware models that emit tool calls as
            // fenced JSON in the text channel instead of via the wire
            // protocol. We synthesise the same UI events the provider
            // would have so downstream code is uniform, and replace the
            // accumulated text with the parser's cleaned version so the
            // raw JSON payload doesn't show up next to the tool card.
            if emitted_tool_calls.is_empty() && !accumulated_text.is_empty() {
                let parsed = extract_fallback_tool_calls(&accumulated_text, &tool_registry);
                if !parsed.calls.is_empty() {
                    // Tell the UI to drop everything streamed so far for
                    // this turn — we're about to replace it with the
                    // cleaned text. Without this the raw fenced JSON
                    // stays rendered in the chat alongside the tool card.
                    let _ = app_handle.emit(
                        STREAM_EVENT,
                        StreamPayload::ReplaceText {
                            run_id: run_id_bg.clone(),
                            text: parsed.cleaned_text.clone(),
                        },
                    );
                    accumulated_text = parsed.cleaned_text;
                    for c in &parsed.calls {
                        let _ = app_handle.emit(
                            STREAM_EVENT,
                            StreamPayload::ToolUseStart {
                                run_id: run_id_bg.clone(),
                                id: c.id.clone(),
                                name: c.name.clone(),
                            },
                        );
                        let fragment =
                            serde_json::to_string(&c.arguments).unwrap_or_else(|_| "{}".into());
                        let _ = app_handle.emit(
                            STREAM_EVENT,
                            StreamPayload::ToolUseArgsDelta {
                                run_id: run_id_bg.clone(),
                                id: c.id.clone(),
                                fragment,
                            },
                        );
                        let _ = app_handle.emit(
                            STREAM_EVENT,
                            StreamPayload::ToolUseDone {
                                run_id: run_id_bg.clone(),
                                id: c.id.clone(),
                            },
                        );
                    }
                    emitted_tool_calls = parsed.calls;
                }
            }

            // No tool calls → terminal turn. Persist + done.
            if emitted_tool_calls.is_empty() {
                if accumulated_text.is_empty() {
                    break;
                }
                let assistant_msg = Message {
                    role: Role::Assistant,
                    content: accumulated_text,
                    tool_call_id: None,
                    tool_name: None,
                    tool_calls: None,
                };
                let store_c = store.clone();
                let cid = convo_id.clone();
                match tokio::task::spawn_blocking(move || {
                    store_c.append_message(&cid, &assistant_msg, None)
                })
                .await
                {
                    Ok(Ok(id)) => last_message_id = id,
                    Ok(Err(e)) => error = Some(format!("persist assistant: {e}")),
                    Err(e) => error = Some(format!("persist join: {e}")),
                }
                break;
            }

            // Has tool calls → persist assistant turn (text + tool_calls)
            // and dispatch each call, persisting results as Tool messages.
            let assistant_msg = Message {
                role: Role::Assistant,
                content: accumulated_text,
                tool_call_id: None,
                tool_name: None,
                tool_calls: Some(emitted_tool_calls.clone()),
            };
            {
                let store_c = store.clone();
                let cid = convo_id.clone();
                let to_persist = assistant_msg.clone();
                if let Err(e) = tokio::task::spawn_blocking(move || {
                    store_c.append_message(&cid, &to_persist, None)
                })
                .await
                .map_err(|e| format!("persist join: {e}"))
                .and_then(|r| r.map_err(|e| format!("persist assistant: {e}")))
                {
                    error = Some(e);
                    break;
                }
            }
            // Mirror the persisted turn into the in-memory buffer so the
            // next iteration's prompt includes it without re-reading SQLite.
            messages.push(assistant_msg);

            // Dispatch each tool call. Within one assistant turn, identical
            // (name, args) pairs are deduped so two parallel read_file
            // calls on the same path only hit disk once.
            let mut all_succeeded = true;
            let mut turn_cache: std::collections::HashMap<String, ToolResult> =
                std::collections::HashMap::new();
            for call in emitted_tool_calls {
                if cancel.is_cancelled() {
                    cancelled = true;
                    break;
                }
                let dispatch_call = ToolCall {
                    name: call.name.clone(),
                    arguments: call.arguments.clone(),
                };
                let cache_key = format!(
                    "{}::{}",
                    call.name,
                    serde_json::to_string(&call.arguments).unwrap_or_default()
                );
                let result = if let Some(cached) = turn_cache.get(&cache_key) {
                    cached.clone()
                } else {
                    let r = tool_registry
                        .dispatch(dispatch_call, &gate, &workspace, &scope_default)
                        .await;
                    turn_cache.insert(cache_key, r.clone());
                    r
                };
                let (ok, output) = match &result {
                    ToolResult::Ok { value } => (true, value.clone()),
                    ToolResult::Denied { reason } => {
                        all_succeeded = false;
                        (false, serde_json::json!({ "denied": reason }))
                    }
                    ToolResult::Error { message } => {
                        all_succeeded = false;
                        (false, serde_json::json!({ "error": message }))
                    }
                };
                let _ = app_handle.emit(
                    STREAM_EVENT,
                    StreamPayload::ToolResult {
                        run_id: run_id_bg.clone(),
                        id: call.id.clone(),
                        name: call.name.clone(),
                        ok,
                        output: output.clone(),
                    },
                );
                // The text we hand back to the model differs from the JSON
                // envelope the UI sees: small models attend to imperative
                // prose ("Try again with corrected arguments") far more
                // reliably than to a JSON blob. This is Aider's reflection
                // pattern adapted for tool calls — see commands/agent.rs
                // commit notes for the May 2026 research pass.
                let result_text = match &result {
                    ToolResult::Ok { value } => serde_json::to_string(value)
                        .unwrap_or_else(|_| "(unserialisable result)".into()),
                    ToolResult::Denied { reason } => format!(
                        "TOOL_DENIED ({tool}): {reason}\n\
                         The user declined this action. Do NOT retry the same call. \
                         Acknowledge the denial in plain text or propose a different approach.",
                        tool = call.name,
                    ),
                    ToolResult::Error { message } => {
                        let hint = repair_hint_for(&call.name, &call.arguments, message);
                        let hint_line = if hint.is_empty() {
                            String::new()
                        } else {
                            format!("\n{hint}")
                        };
                        format!(
                            "TOOL_ERROR ({tool}): {message}{hint_line}\n\
                             Try again with corrected arguments, OR explain in plain \
                             text why this approach won't work and ask the user how to proceed.",
                            tool = call.name,
                        )
                    }
                };
                let tool_msg = Message {
                    role: Role::Tool,
                    content: result_text,
                    // Carry both: opaque id (Anthropic/OpenAI/LM Studio
                    // link by this) AND function name (Gemini/Ollama
                    // link by this). Each provider picks the field its
                    // wire format expects.
                    tool_call_id: Some(call.id.clone()),
                    tool_name: Some(call.name.clone()),
                    tool_calls: None,
                };
                let store_c = store.clone();
                let cid = convo_id.clone();
                let to_persist = tool_msg.clone();
                if let Err(e) = tokio::task::spawn_blocking(move || {
                    store_c.append_message(&cid, &to_persist, None)
                })
                .await
                .map_err(|e| format!("persist join: {e}"))
                .and_then(|r| r.map_err(|e| format!("persist tool: {e}")))
                {
                    error = Some(e);
                    break;
                }
                messages.push(tool_msg);
            }

            if cancelled || error.is_some() {
                break;
            }
            // If everything succeeded, loop again to let the model use the
            // results. Loop exit is gated on the model returning text without
            // any further tool calls (handled at the top of the next iter).
            let _ = all_succeeded;
        }

        if iteration >= MAX_AGENT_ITERATIONS && error.is_none() && !cancelled {
            error = Some(format!(
                "agent loop exceeded {MAX_AGENT_ITERATIONS} iterations — model kept calling tools without finalising"
            ));
        }

        app_handle.state::<AppState>().drop_agent_run(&run_id_bg);

        if cancelled {
            let _ = app_handle.emit(
                STREAM_EVENT,
                StreamPayload::Cancelled {
                    run_id: run_id_bg.clone(),
                },
            );
            return;
        }
        if let Some(msg) = error {
            let _ = app_handle.emit(
                STREAM_EVENT,
                StreamPayload::Error {
                    run_id: run_id_bg.clone(),
                    message: msg,
                },
            );
            return;
        }
        let _ = app_handle.emit(
            STREAM_EVENT,
            StreamPayload::Done {
                run_id: run_id_bg,
                message_id: last_message_id,
            },
        );
    });

    Ok(SendMessageResponse { run_id })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRequest {
    pub run_id: String,
}

#[tauri::command]
pub async fn agent_cancel(state: State<'_, AppState>, req: CancelRequest) -> AppResult<bool> {
    Ok(state.cancel_agent_run(&req.run_id))
}

// ---------------------------------------------------------------------------
// Inline edit proposals (M3 Phase 3)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeEditRequest {
    pub workspace_path: Option<String>,
    pub path: String,
    pub new_text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditProposal {
    pub proposal_id: String,
    pub path: String,
    pub hunks: Vec<EditHunk>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyEditRequest {
    pub proposal_id: String,
    pub accepted_hunk_indices: Vec<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub path: String,
    pub bytes: u64,
    pub line_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectEditRequest {
    pub proposal_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingEdit {
    pub proposal_id: String,
    pub path: String,
    pub hunk_count: usize,
}

fn parse_uuid(s: &str) -> AppResult<Uuid> {
    Uuid::from_str(s).map_err(|e| AppError::Internal(format!("invalid proposal_id: {e}")))
}

#[tauri::command]
pub async fn agent_propose_edit(
    state: tauri::State<'_, AppState>,
    req: ProposeEditRequest,
) -> AppResult<EditProposal> {
    let _ = req.workspace_path; // reserved for future workspace-scoped sandboxing
    let path = PathBuf::from(&req.path);
    let old_text = read_file_at(&path).await?;
    let proposal = ProposeEdit::new(path.clone(), old_text, req.new_text);
    let hunks = proposal.hunks.clone();
    let id = state.register_pending_edit(proposal);
    Ok(EditProposal {
        proposal_id: id.to_string(),
        path: path.display().to_string(),
        hunks,
    })
}

#[tauri::command]
pub async fn agent_apply_edit(
    state: tauri::State<'_, AppState>,
    req: ApplyEditRequest,
) -> AppResult<ApplyResult> {
    let id = parse_uuid(&req.proposal_id)?;
    let proposal = state
        .peek_pending_edit(id)
        .ok_or_else(|| AppError::Internal(format!("unknown proposal_id: {}", req.proposal_id)))?;
    let final_text = apply_accepted_hunks(
        &proposal.old_text,
        &proposal.hunks,
        &req.accepted_hunk_indices,
    );
    write_file_at(&proposal.path, &final_text).await?;
    let _ = state.take_pending_edit(id);
    let bytes = u64::try_from(final_text.len()).unwrap_or(u64::MAX);
    let line_count = final_text.lines().count();
    Ok(ApplyResult {
        path: proposal.path.display().to_string(),
        bytes,
        line_count,
    })
}

#[tauri::command]
pub async fn agent_reject_edit(
    state: tauri::State<'_, AppState>,
    req: RejectEditRequest,
) -> AppResult<()> {
    let id = parse_uuid(&req.proposal_id)?;
    let _ = state.take_pending_edit(id);
    Ok(())
}

#[tauri::command]
pub async fn agent_list_pending_edits(
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<PendingEdit>> {
    Ok(state
        .list_pending_edits()
        .into_iter()
        .map(|(id, path, hunk_count)| PendingEdit {
            proposal_id: id.to_string(),
            path: path.display().to_string(),
            hunk_count,
        })
        .collect())
}

async fn load_key(provider: &str) -> AppResult<String> {
    let provider = provider.to_string();
    let key: AgentResult<Option<String>> =
        tokio::task::spawn_blocking(move || keychain::get_key(&provider))
            .await
            .map_err(|e| AppError::Internal(format!("agent join: {e}")))?;
    match key.map_err(map_agent)? {
        Some(k) => Ok(k),
        None => Err(AppError::Internal("no api key configured".into())),
    }
}

// ─── Symbol index (M3 Phase 4) ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRebuildRequest {
    pub workspace_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRebuildResponse {
    pub indexed: usize,
    pub duration_ms: u128,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSearchRequest {
    pub workspace_path: String,
    pub query: String,
    pub limit: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatusRequest {
    pub workspace_path: String,
}

fn db_path_for(workspace: &Path) -> PathBuf {
    workspace.join(".daisu").join("symbols.db")
}

fn get_or_open_indexer(state: &AppState, workspace: &Path) -> AppResult<Arc<Indexer>> {
    state
        .indexer_get_or_init(workspace, |normalised| {
            let db_path = db_path_for(normalised);
            Indexer::new(normalised, &db_path).map_err(|e| format!("agent: {e}"))
        })
        .map_err(AppError::Internal)
}

#[tauri::command]
pub async fn agent_index_rebuild(
    state: State<'_, AppState>,
    req: IndexRebuildRequest,
) -> AppResult<IndexRebuildResponse> {
    let workspace = PathBuf::from(&req.workspace_path);
    let indexer = get_or_open_indexer(&state, &workspace)?;
    let started = std::time::Instant::now();
    let indexed = tokio::task::spawn_blocking(move || indexer.rebuild())
        .await
        .map_err(|e| AppError::Internal(format!("index join: {e}")))?
        .map_err(map_agent)?;
    Ok(IndexRebuildResponse {
        indexed,
        duration_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
pub async fn agent_index_search(
    state: State<'_, AppState>,
    req: IndexSearchRequest,
) -> AppResult<Vec<SymbolHit>> {
    let workspace = PathBuf::from(&req.workspace_path);
    let indexer = get_or_open_indexer(&state, &workspace)?;
    let query = req.query;
    let limit = req.limit;
    let hits = tokio::task::spawn_blocking(move || indexer.search(&query, limit))
        .await
        .map_err(|e| AppError::Internal(format!("index join: {e}")))?
        .map_err(map_agent)?;
    Ok(hits)
}

#[tauri::command]
pub async fn agent_index_status(
    state: State<'_, AppState>,
    req: IndexStatusRequest,
) -> AppResult<IndexStatus> {
    let workspace = PathBuf::from(&req.workspace_path);
    let indexer = get_or_open_indexer(&state, &workspace)?;
    let status = tokio::task::spawn_blocking(move || indexer.status())
        .await
        .map_err(|e| AppError::Internal(format!("index join: {e}")))?
        .map_err(map_agent)?;
    Ok(status)
}
