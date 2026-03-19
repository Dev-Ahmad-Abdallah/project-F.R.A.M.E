-- Migration 013: Missing indexes and FK constraints for performance + integrity

-- Index on prev_event_id for message chain lookups
CREATE INDEX IF NOT EXISTS idx_events_prev_event_id ON events(prev_event_id);

-- Index on key_bundles.device_id for single-device lookups
CREATE INDEX IF NOT EXISTS idx_key_bundles_device_id ON key_bundles(device_id);

-- Index on push_subscriptions.device_id for cleanup queries
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_device_id ON push_subscriptions(device_id);

-- FK: push_subscriptions.device_id should reference devices
-- Using DO block to avoid error if constraint already exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_push_subscriptions_device'
  ) THEN
    ALTER TABLE push_subscriptions
      ADD CONSTRAINT fk_push_subscriptions_device
      FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE;
  END IF;
END $$;
