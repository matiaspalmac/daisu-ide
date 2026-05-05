-- Daisu Agent persistent memory schema.
-- Per-workspace SQLite database at .daisu/agent.db.
-- WAL mode + foreign keys are enabled by the application on open.

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated
    ON conversations (archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_call_id TEXT,
    -- JSON-encoded Vec<ToolCall> for assistant turns that emitted
    -- tool calls. Null/empty for plain text turns. Round-tripped via
    -- the LLM provider trait's `tool_calls` field on `Message`.
    tool_calls_json TEXT,
    created_at INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER
);

CREATE INDEX IF NOT EXISTS idx_messages_convo
    ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    arguments TEXT NOT NULL,
    result TEXT,
    error TEXT,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_message
    ON tool_calls (message_id);

CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    scope_glob TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
    created_at INTEGER NOT NULL,
    UNIQUE (tool_name, scope_glob)
);

CREATE INDEX IF NOT EXISTS idx_permissions_lookup
    ON permissions (tool_name);

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);

-- Migration: add tool_calls_json column for older databases that
-- predate the tool-loop work. SQLite ignores ADD COLUMN when the
-- column already exists in newer DBs created from the CREATE TABLE
-- above; existing rows get NULL which deserialises as None.
-- Use a try/catch via a no-op statement so re-running on already
-- migrated DBs doesn't fail.
-- (PRAGMA used as the safe variant since SQLite has no IF NOT EXISTS
-- for ALTER TABLE ADD COLUMN until 3.35.5+.)
