-- 011: File attachments for secure E2EE file sharing
CREATE TABLE IF NOT EXISTS file_attachments (
  file_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  encrypted_blob BYTEA NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_attachments_room ON file_attachments(room_id);
CREATE INDEX IF NOT EXISTS idx_file_attachments_sender ON file_attachments(sender_id);
