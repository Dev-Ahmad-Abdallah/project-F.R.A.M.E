-- Migration: 006_device-keys-json
-- Store the full signed device_keys JSON from OlmMachine KeysUploadRequest
-- so /keys/query can return keys with original signatures intact.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_keys_json JSONB;
