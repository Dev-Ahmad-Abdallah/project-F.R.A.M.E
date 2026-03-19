-- Migration: 009_reactions-readreceipts-displayname
-- Adds message reactions, read receipts, and user display names

-- ── Display name on users ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;

-- ── Reactions on events ──
-- Stores reactions as JSONB: { "emoji": { "users": ["@user1:host", ...], "count": N } }
ALTER TABLE events ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '{}'::jsonb;

-- ── Read receipts ──
CREATE TABLE IF NOT EXISTS read_receipts (
  room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_read_receipts_event ON read_receipts(event_id);
CREATE INDEX IF NOT EXISTS idx_read_receipts_room ON read_receipts(room_id);
