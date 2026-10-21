-- ============================================================================
-- MazenOS Master Relational Schema (Cloudflare D1 / SQLite)
-- Migration: 0001_mazenos_schema.sql
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Full Chat Persistence & Rollback Ledger
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent TEXT NOT NULL CHECK (agent IN ('ari', 'jade')),
    sender TEXT NOT NULL CHECK (sender IN ('user', 'assistant')),
    message_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 4), -- 1: Urgent & Important to 4: Backlog
    is_consecutive BOOLEAN NOT NULL DEFAULT 0,
    depends_on_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    due_timestamp DATETIME,
    estimated_duration_minutes INTEGER NOT NULL DEFAULT 45,
    status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'archived')) DEFAULT 'pending',
    is_bonus BOOLEAN NOT NULL DEFAULT 0,
    original_scheduled_date DATE,
    ai_audit_criteria TEXT,
    requires_video BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority, due_timestamp);
CREATE INDEX IF NOT EXISTS idx_tasks_depends ON tasks(depends_on_task_id);

CREATE TABLE IF NOT EXISTS subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    is_completed BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

CREATE TABLE IF NOT EXISTS audit_receipts (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    verdict TEXT NOT NULL CHECK (verdict IN ('passed', 'failed')),
    score INTEGER CHECK (score BETWEEN 1 AND 10),
    critique TEXT NOT NULL,
    evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_receipts(task_id, evaluated_at);

CREATE TABLE IF NOT EXISTS daily_health_logs (
    date DATE PRIMARY KEY,
    sleep_hours REAL,
    energy_rating INTEGER CHECK (energy_rating BETWEEN 1 AND 5),
    is_sick BOOLEAN NOT NULL DEFAULT 0,
    sickness_notes TEXT,
    medicine_target_count INTEGER NOT NULL DEFAULT 0,
    medicine_taken_count INTEGER NOT NULL DEFAULT 0,
    workout_completed BOOLEAN NOT NULL DEFAULT 0,
    workout_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS study_locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    google_maps_url TEXT,
    service_type TEXT,
    quietness_rating INTEGER CHECK (quietness_rating BETWEEN 1 AND 5),
    commute_minutes_one_way INTEGER NOT NULL,
    average_cost_sar REAL NOT NULL DEFAULT 0.0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS idea_vault (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    domain_tag TEXT CHECK (domain_tag IN ('coding', 'personal', 'hardware', 'general')) DEFAULT 'general',
    is_locked BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_synthesized BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS curriculum_units (
    id TEXT PRIMARY KEY,
    exam_name TEXT NOT NULL,
    unit_number INTEGER NOT NULL,
    topic_title TEXT NOT NULL,
    difficulty_level INTEGER CHECK (difficulty_level BETWEEN 1 AND 5) NOT NULL DEFAULT 3,
    estimated_hours REAL NOT NULL DEFAULT 2.0,
    is_main_objective BOOLEAN NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed')) DEFAULT 'not_started',
    target_completion_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_curriculum_exam_status ON curriculum_units(exam_name, status, is_main_objective);

CREATE TABLE IF NOT EXISTS budget_entries (
    id TEXT PRIMARY KEY,
    wallet_source TEXT NOT NULL,
    merchant TEXT,
    amount_sar REAL NOT NULL,
    balance_after_sar REAL,
    transaction_timestamp DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_budget_timestamp ON budget_entries(transaction_timestamp DESC);

CREATE TABLE IF NOT EXISTS diary_entries (
    id TEXT PRIMARY KEY,
    entry_text TEXT NOT NULL,
    mood_indicator TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS focus_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 25,
    session_type TEXT NOT NULL CHECK (session_type IN ('pomodoro', 'break', 'deep_work')) DEFAULT 'pomodoro',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_focus_started ON focus_sessions(started_at DESC);

-- Default Single-Operator Bootstrap Settings
INSERT OR IGNORE INTO system_settings (key, value) VALUES
    ('active_provider', 'gemini'),
    ('active_tier', 'light'),
    ('rest_window', '00:00 - 00:45'),
    ('budget_balance_sar', '88.33'),
    ('idea_vault_locked', '1'),
    ('friday_hobby_safeguard', '1'),
    ('weekend_saved_minutes', '0'),
    ('daily_entertainment_quota_mins', '90'),
    ('daily_entertainment_used_mins', '0'),
    ('active_session_ari', 'sess_ari_default'),
    ('active_session_jade', 'sess_jade_default');
