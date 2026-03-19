-- Migration: 004_to-device-claimed-at
-- Add claimed_at column for safe to-device message delivery.
-- Messages are claimed during sync and only deleted after confirmation
-- or after being stale for 5+ minutes (client disconnected mid-response).

ALTER TABLE to_device_messages ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_todevice_stale_cleanup
  ON to_device_messages(claimed_at)
  WHERE claimed_at IS NOT NULL;
