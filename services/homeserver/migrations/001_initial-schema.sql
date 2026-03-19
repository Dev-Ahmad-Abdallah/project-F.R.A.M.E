-- Migration: 001_initial-schema
-- Creates all tables for the F.R.A.M.E. homeserver

-- ── Users ──
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  homeserver TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Devices ──
CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  device_public_key TEXT NOT NULL,
  device_signing_key TEXT NOT NULL,
  display_name TEXT,
  last_seen TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- ── Rooms ──
CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  room_type TEXT NOT NULL DEFAULT 'direct' CHECK (room_type IN ('direct', 'group')),
  name TEXT,
  settings JSONB DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(user_id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Room Membership ──
CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

-- ── Encrypted Events (Messages) ──
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  sender_id TEXT NOT NULL REFERENCES users(user_id),
  sender_device_id TEXT,  -- Nullable: federation events have remote device IDs not in local DB
  event_type TEXT NOT NULL,
  ciphertext BYTEA,
  content JSONB,
  sequence_id BIGSERIAL,
  origin_server TEXT,
  origin_ts TIMESTAMP WITH TIME ZONE NOT NULL,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_room_seq ON events(room_id, sequence_id);
CREATE INDEX IF NOT EXISTS idx_events_room_ts ON events(room_id, origin_ts);

-- ── Key Bundles ──
CREATE TABLE IF NOT EXISTS key_bundles (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  identity_key TEXT NOT NULL,
  signed_prekey TEXT NOT NULL,
  signed_prekey_signature TEXT NOT NULL,
  one_time_prekeys JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, device_id)
);

-- ── Key Transparency Log (Append-Only) ──
CREATE TABLE IF NOT EXISTS key_transparency_log (
  log_id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  merkle_proof JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ktl_user ON key_transparency_log(user_id);

-- ── Delivery State ──
CREATE TABLE IF NOT EXISTS delivery_state (
  event_id TEXT NOT NULL REFERENCES events(event_id),
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts INT DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (event_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_pending
  ON delivery_state(device_id, status) WHERE status = 'pending';

-- ── Refresh Tokens ──
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_expires ON refresh_tokens(expires_at);
