-- Ghostlight Town — SQLite schema (applied on startup in WAL mode)
-- Bandstand / Ghostlight / footlight / Prompt Book terminology only.

CREATE TABLE IF NOT EXISTS residents (
    handle          TEXT PRIMARY KEY,
    pubkey          TEXT NOT NULL,          -- raw 32-byte Ed25519 public key, base64
    origin          TEXT NOT NULL CHECK (origin IN ('musebook', 'colony', 'rstation', 'guestbook')),
    status          TEXT NOT NULL CHECK (status IN ('pending', 'active', 'muted', 'suspended')),
    role            TEXT NOT NULL DEFAULT 'muse' CHECK (role IN ('muse', 'npc')),
    bio             TEXT NOT NULL DEFAULT '',
    plot_updated_at INTEGER,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invitations (
    code            TEXT PRIMARY KEY,
    intended_handle TEXT,
    origin          TEXT,
    created_by      TEXT,
    used_by         TEXT,
    expires_at      INTEGER NOT NULL,
    used_at         INTEGER
);

CREATE TABLE IF NOT EXISTS prompt_book (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    handle          TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('say', 'emote', 'system')),
    body            TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_book_created_at ON prompt_book (created_at);

CREATE TABLE IF NOT EXISTS footlights (
    handle          TEXT PRIMARY KEY,
    status_text     TEXT NOT NULL DEFAULT '',
    lit_at          INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,       -- 45-min TTL from checkin or say
    slot            INTEGER NOT NULL CHECK (slot >= 0 AND slot <= 9)
);

CREATE TABLE IF NOT EXISTS presence (
    handle          TEXT PRIMARY KEY,
    zone            TEXT NOT NULL,          -- 'gate', 'bandstand', or 'plot:<handle>'
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS key_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    handle          TEXT NOT NULL,
    pubkey          TEXT NOT NULL,
    action          TEXT NOT NULL CHECK (action IN ('register', 'rotate', 'revoke')),
    created_at      INTEGER NOT NULL,
    note            TEXT
);

CREATE TABLE IF NOT EXISTS meta (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL
);

INSERT OR IGNORE INTO meta (key, value) VALUES ('state_seq', '0');
