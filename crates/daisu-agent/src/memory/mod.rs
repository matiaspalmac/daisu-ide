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
    conn: Mutex<Connection>,
}

impl MemoryStore {
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
        Ok(Self {
            conn: Mutex::new(conn),
        })
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
        let guard = self
            .conn
            .lock()
            .map_err(|_| crate::error::AgentError::Internal("memory mutex poisoned".into()))?;
        guard.execute(
            "INSERT INTO messages (id, conversation_id, role, content, tool_call_id, created_at, input_tokens, output_tokens) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                conversation_id,
                role,
                msg.content,
                msg.tool_call_id,
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
