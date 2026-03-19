/**
 * File sharing API for F.R.A.M.E.
 *
 * Handles uploading encrypted file blobs and downloading them.
 * All file content is encrypted CLIENT-SIDE before upload — the server
 * only ever sees ciphertext.
 */

import { getAccessToken } from './client';

// Allowed MIME types for upload
export const ALLOWED_FILE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const FRIENDLY_FILE_TYPES = 'Images (JPEG, PNG, GIF, WebP), PDF, TXT, DOC/DOCX';

export interface FileUploadResult {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

/**
 * Upload an encrypted file blob to the server.
 */
export async function uploadFile(
  encryptedBlob: Uint8Array,
  roomId: string,
  fileName: string,
  mimeType: string,
): Promise<FileUploadResult> {
  const formData = new FormData();
  formData.append('file', new Blob([encryptedBlob]), 'encrypted');
  formData.append('roomId', roomId);
  formData.append('fileName', fileName);
  formData.append('mimeType', mimeType);

  const token = getAccessToken();
  const baseUrl =
    process.env.REACT_APP_HOMESERVER_URL ?? 'http://localhost:3000';

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/files/upload`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  if (!response.ok) {
    let msg = 'Upload failed';
    try {
      const err = await response.json() as { error?: { message?: string } };
      if (err?.error?.message) msg = err.error.message;
    } catch { /* ignore parse errors */ }
    throw new Error(msg);
  }

  return response.json() as Promise<FileUploadResult>;
}

/**
 * Download an encrypted file blob from the server.
 */
export async function downloadFile(fileId: string): Promise<ArrayBuffer> {
  const token = getAccessToken();
  const baseUrl =
    process.env.REACT_APP_HOMESERVER_URL ?? 'http://localhost:3000';

  const response = await fetch(
    `${baseUrl.replace(/\/+$/, '')}/files/${encodeURIComponent(fileId)}`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );

  if (!response.ok) {
    throw new Error('Download failed');
  }

  return response.arrayBuffer();
}
