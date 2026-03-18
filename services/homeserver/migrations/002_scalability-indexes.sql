-- Migration: 002_scalability-indexes
-- Additional indexes for 100+ concurrent user support

-- Faster event lookups by sender
CREATE INDEX IF NOT EXISTS idx_events_sender ON events(sender_id);

-- Faster batch delivery state updates by event_id
CREATE INDEX IF NOT EXISTS idx_delivery_event ON delivery_state(event_id);

-- Faster delivery lookups by device + status (covering index)
CREATE INDEX IF NOT EXISTS idx_delivery_device_status ON delivery_state(device_id, status);

-- Faster key bundle lookups for batch queryDeviceKeys
CREATE INDEX IF NOT EXISTS idx_key_bundles_user ON key_bundles(user_id);

-- Set statement timeout to prevent runaway queries (30 seconds)
ALTER DATABASE CURRENT SET statement_timeout = '30s';
