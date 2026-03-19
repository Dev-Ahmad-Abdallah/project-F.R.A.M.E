import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { fileUploadLimiter } from '../middleware/rateLimit';
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
]);

// ── Multer setup (memory storage — encrypted blob goes straight to PG) ──

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

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

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(mimeTypeValue)) {
      throw new ApiError(400, 'M_BAD_MIME_TYPE', 'File type is not allowed');
    }

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

filesRouter.get(
  '/:fileId',
  requireAuth,
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
