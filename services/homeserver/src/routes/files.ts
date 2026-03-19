import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { fileUploadLimiter, apiLimiter } from '../middleware/rateLimit';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { isRoomMember } from '../db/queries/rooms';
import { pool } from '../db/pool';

export const filesRouter = Router();

// ── Constants ──

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/json',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
]);

// ── Multer setup (memory storage — encrypted blob goes straight to PG) ──
//
// H-3 NOTE: File attachments are currently stored as raw BLOBs in PostgreSQL
// (file_attachments.encrypted_blob). For production scale, consider migrating
// to object storage (S3/R2) with only metadata in PG. The 10 MB multer limit
// below is enforced at the middleware layer to bound memory usage per request.

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

// ── Magic byte signatures for MIME type validation ──

/**
 * Validate that the file content's magic bytes match the claimed MIME type.
 * Returns true if the content matches or if we can't check (e.g. text types).
 * Returns false if the magic bytes contradict the claimed type.
 */
function validateMagicBytes(buffer: Buffer, claimedMime: string): boolean {
  if (buffer.length < 4) return false;

  // Define magic byte signatures for binary formats
  const signatures: Record<string, { bytes: number[]; offset?: number }[]> = {
    'image/jpeg': [{ bytes: [0xFF, 0xD8, 0xFF] }],
    'image/png': [{ bytes: [0x89, 0x50, 0x4E, 0x47] }],
    'image/gif': [{ bytes: [0x47, 0x49, 0x46, 0x38] }],
    'image/webp': [{ bytes: [0x52, 0x49, 0x46, 0x46] }],
    'application/pdf': [{ bytes: [0x25, 0x50, 0x44, 0x46] }],
    'application/zip': [{ bytes: [0x50, 0x4B, 0x03, 0x04] }],
    'application/x-zip-compressed': [{ bytes: [0x50, 0x4B, 0x03, 0x04] }],
    'application/msword': [{ bytes: [0xD0, 0xCF, 0x11, 0xE0] }],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
      { bytes: [0x50, 0x4B, 0x03, 0x04] },
    ],
  };

  // For text-based formats, verify content looks like text (no null bytes in first 512 bytes)
  const textTypes = new Set(['text/plain', 'text/csv', 'application/json']);
  if (textTypes.has(claimedMime)) {
    const checkLen = Math.min(buffer.length, 512);
    for (let i = 0; i < checkLen; i++) {
      if (buffer[i] === 0x00) return false;
    }
    return true;
  }

  const sigs = signatures[claimedMime];
  if (!sigs) return true;

  // Special check for WEBP: RIFF header + "WEBP" at offset 8
  if (claimedMime === 'image/webp') {
    if (buffer.length < 12) return false;
    const riff = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
    const webp = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
    return riff && webp;
  }

  return sigs.some((sig) => {
    const offset = sig.offset ?? 0;
    if (buffer.length < offset + sig.bytes.length) return false;
    return sig.bytes.every((byte, i) => buffer[offset + i] === byte);
  });
}

// ── Helpers ──

/**
 * Sanitize a file name: strip path components, limit length, reject if empty.
 */
function sanitizeFileName(raw: string): string {
  // Reject path traversal patterns
  if (raw.includes('..') || raw.includes('/') || raw.includes('\\')) {
    throw new ApiError(400, 'M_BAD_FILENAME', 'File name must not contain path traversal characters');
  }

  // Strip any remaining path separators (belt-and-suspenders)
  let sanitized = raw.replace(/[/\\]/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  // Limit to 255 characters
  if (sanitized.length > 255) {
    sanitized = sanitized.slice(0, 255);
  }

  if (sanitized.length === 0) {
    throw new ApiError(400, 'M_BAD_FILENAME', 'File name must not be empty');
  }

  return sanitized;
}

// ── DB row type ──

interface FileAttachmentRow {
  file_id: string;
  room_id: string;
  sender_id: string;
  encrypted_blob: Buffer;
  file_name: string;
  mime_type: string;
  file_size: number;
  created_at: Date;
}

// ── POST /files/upload ──

filesRouter.post(
  '/upload',
  requireAuth,
  fileUploadLimiter,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }

    const file = req.file;
    if (!file) {
      throw new ApiError(400, 'M_MISSING_FILE', 'No file provided');
    }

    // Extract fields from the multipart form
    const roomId = req.body as Record<string, unknown>;
    const roomIdValue = typeof roomId['roomId'] === 'string' ? roomId['roomId'] : undefined;
    const fileNameValue = typeof roomId['fileName'] === 'string' ? roomId['fileName'] : undefined;
    const mimeTypeValue = typeof roomId['mimeType'] === 'string' ? roomId['mimeType'] : undefined;

    if (!roomIdValue) {
      throw new ApiError(400, 'M_BAD_JSON', 'roomId is required');
    }
    if (!fileNameValue) {
      throw new ApiError(400, 'M_BAD_JSON', 'fileName is required');
    }
    if (!mimeTypeValue) {
      throw new ApiError(400, 'M_BAD_JSON', 'mimeType is required');
    }

    // Validate MIME type against allowlist
    if (!ALLOWED_MIME_TYPES.has(mimeTypeValue)) {
      throw new ApiError(400, 'M_BAD_MIME_TYPE', 'File type is not allowed');
    }

    // NOTE: Magic byte validation is intentionally skipped. Files are encrypted
    // client-side (AES-256-GCM) before upload, so the encrypted blob contains
    // ciphertext that will never match plaintext magic byte signatures. The MIME
    // type is validated against the allowlist above; content-type verification
    // happens client-side before encryption.

    // Validate file size (belt-and-suspenders — multer also enforces this)
    if (file.size > MAX_FILE_SIZE) {
      throw new ApiError(413, 'M_TOO_LARGE', 'File exceeds the 10 MB size limit');
    }

    // Sanitize file name
    const sanitizedName = sanitizeFileName(fileNameValue);

    // Verify room membership
    if (!(await isRoomMember(roomIdValue, req.auth.sub))) {
      throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
    }

    // Generate file ID
    const fileId = `$file-${crypto.randomBytes(16).toString('hex')}`;

    // Store in database
    await pool.query(
      `INSERT INTO file_attachments (file_id, room_id, sender_id, encrypted_blob, file_name, mime_type, file_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [fileId, roomIdValue, req.auth.sub, file.buffer, sanitizedName, mimeTypeValue, file.size],
    );

    res.json({
      fileId,
      fileName: sanitizedName,
      mimeType: mimeTypeValue,
      fileSize: file.size,
    });
  }),
);

// ── GET /files/:fileId ──

// H-4 FIX: Added apiLimiter to prevent unlimited file download abuse
filesRouter.get(
  '/:fileId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }

    const { fileId } = req.params;

    // Look up the file
    const result = await pool.query<FileAttachmentRow>(
      'SELECT * FROM file_attachments WHERE file_id = $1',
      [fileId],
    );

    if (result.rows.length === 0) {
      throw new ApiError(404, 'M_NOT_FOUND', 'File not found');
    }

    const fileRow = result.rows[0];

    // Verify room membership
    if (!(await isRoomMember(fileRow.room_id, req.auth.sub))) {
      throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
    }

    // Sanitize the file name for Content-Disposition header
    // Replace any non-ASCII or control characters, and quote the name
    const safeFileName = fileRow.file_name
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/"/g, '\\"');

    // SECURITY: Always serve as opaque binary — never trust stored MIME type
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeFileName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });

    res.send(fileRow.encrypted_blob);
  }),
);
