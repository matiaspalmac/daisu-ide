//! Persistent memory store backed by per-workspace SQLite.

use std::path::Path;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::error::AgentResult;
use crate::provider::{Message, Role};

const SCHEMA: &str = include_str!("schema.sql");

pub struct MemoryStore {
    conn: std::sync::Arc<Mutex<Connection>>,
}

impl MemoryStore {
    /// Shared handle to the underlying connection. Used by ancillary
    /// modules (e.g. [`crate::permission::gate::PermissionGate`]) that
    /// need to query workspace-scoped tables on the same database.
    #[must_use]
    pub fn connection(&self) -> std::sync::Arc<Mutex<Connection>> {
        self.conn.clone()
    }

    pub fn open(path: impl AsRef<Path>) -> AgentResult<Self> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;\n\
             PRAGMA foreign_keys=ON;\n\
             PRAGMA synchronous=NORMAL;",
        )?;
        conn.execute_batch(SCHEMA)?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: std::sync::Arc::new(Mutex::new(conn)),
        })
    }

    /// Apply schema migrations idempotently. SQLite's `CREATE TABLE IF
    /// NOT EXISTS` won't add columns to a table that already exists, so
    /// post-launch column additions need explicit `ALTER TABLE`.
    fn migrate(conn: &Connection) -> AgentResult<()> {
        let existing: std::collections::HashSet<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(messages)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        // tool_calls_json — added when the agentic tool loop landed.
        if !existing.contains("tool_calls_json") {
            conn.execute_batch("ALTER TABLE messages ADD COLUMN tool_calls_json TEXT")?;
        }
        // tool_name — added when tool result correlation was split off
        // from tool_call_id (Gemini/Ollama link by function name).
        if !existing.contains("tool_name") {
            conn.execute_batch("ALTER TABLE messages ADD COLUMN tool_name TEXT")?;
        }
        Ok(())
    }

    pub fn create_conversation(
        &self,
        title: &str,
        provider: &str,
        model: &str,
    ) -> AgentResult<String> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        let guard = self
            .conn
            .lock()
            .map_err(|_| crate::error::AgentError::Internal("memory mutex poisoned".into()))?;
        guard.execute(
            "INSERT INTO conversations (id, title, provider, model, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, title, provider, model, now],
        )?;
        Ok(id)
    }

    pub fn append_message(
        &self,
        conversation_id: &str,
        msg: &Message,
        usage: Option<(u32, u32)>,
    ) -> AgentResult<String> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        let role = match msg.role {
            Role::System => "system",
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::Tool => "tool",
        };
        let tool_calls_json = msg
            .tool_calls
            .as_ref()
            .filter(|v| !v.is_empty())
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| {
                crate::error::AgentError::Internal(format!("serialise tool_calls: {e}"))
            })?;
        let guard = self
            .conn
            .lock()
            .map_err(|_| crate::error::AgentError::Internal("memory mutex poisoned".into()))?;
        guard.execute(
            "INSERT INTO messages (id, conversation_id, role, content, tool_call_id, tool_name, tool_calls_json, created_at, input_tokens, output_tokens) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                conversation_id,
                role,
                msg.content,
                msg.tool_call_id,
                msg.tool_name,
                tool_calls_json,
                now,
                usage.map(|(i, _)| i),
                usage.map(|(_, o)| o)
            ],
        )?;
        guard.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now, conversation_id],
        )?;
        Ok(id)
    }

    pub fn get_conversation(&self, id: &str) -> AgentResult<Option<ConversationSummary>> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| crate::error::AgentError::Internal("memory mutex poisoned".into()))?;
        let mut stmt = guard.prepare(
            "SELECT id, title, provider, model, created_at, updated_at \
             FROM conversations WHERE id = ?1",
        )?;
        let row = stmt.query_row([id], |row| {
            Ok(ConversationSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                provider: row.get(2)?,
                model: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        });
        match row {
            Ok(r) => Ok(Some(r)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn get_messages(&self, conversation_id: &str) -> AgentResult<Vec<StoredMessage>> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| crate::error::AgentError::Internal("memory mutex poisoned".into()))?;
        let mut stmt = guard.prepare(
            "SELECT id, role, content, tool_call_id, tool_name, tool_calls_json, created_at \
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at, id",
        )?;
        let rows = stmt
            .query_map([conversation_id], |row| {
                Ok(StoredMessage {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                    tool_call_id: row.get(3)?,
                    tool_name: row.get(4)?,
                    tool_calls_json: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn rename_conversation(&self, id: &str, title: &str) -> AgentResult<()> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| crate::error::AgentError::Internal("memory mutex poisoned".into()))?;
        guard.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> AgentResult<()> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| crate::error::AgentError::Internal("memory mutex poisoned".into()))?;
        guard.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_conversations(&self) -> AgentResult<Vec<ConversationSummary>> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| crate::error::AgentError::Internal("memory mutex poisoned".into()))?;
        let mut stmt = guard.prepare(
            "SELECT id, title, provider, model, created_at, updated_at \
             FROM conversations WHERE archived = 0 ORDER BY updated_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ConversationSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    provider: row.get(2)?,
                    model: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub provider: String,
    pub model: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StoredMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub tool_call_id: Option<String>,
    /// Function name for tool result messages. Null for non-tool turns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// JSON-encoded `Vec<ProviderToolCall>` when the assistant emitted
    /// tool calls in this turn. Round-trips back through
    /// `Message::tool_calls` so the next provider call can reference
    /// the same ids.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls_json: Option<String>,
    pub created_at: i64,
}
