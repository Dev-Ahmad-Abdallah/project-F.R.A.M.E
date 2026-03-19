-- Migration: 005_room-name
-- Adds name and settings columns to rooms for room renaming and settings support

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;
