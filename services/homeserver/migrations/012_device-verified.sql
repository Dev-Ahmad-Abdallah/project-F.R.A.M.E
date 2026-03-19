-- Migration: 012_device-verified
-- Adds a server-side verified boolean to the devices table
-- so device verification status cannot be forged via localStorage.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;
