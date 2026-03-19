-- Migration: 003_to-device-messages
-- Store to-device messages for reliable E2EE key delivery

CREATE TABLE IF NOT EXISTS to_device_messages (
  id BIGSERIAL PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  recipient_device_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  sender_device_id TEXT,
  event_type TEXT NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_todevice_recipient
  ON to_device_messages(recipient_user_id, recipient_device_id);
