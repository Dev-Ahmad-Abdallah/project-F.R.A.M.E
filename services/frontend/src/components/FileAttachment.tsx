/**
 * FileAttachment — renders a file attachment inside a chat message bubble.
 *
 * Supports two modes:
 * 1. Inline (base64): fileData + fileKey + fileIv are in the E2EE message content.
 *    Decrypt client-side and display/download directly.
 * 2. Server-hosted: fileId points to an encrypted blob on the server.
 *    Download, decrypt, then display/download.
 *
 * For image types, shows an inline thumbnail preview after decryption.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { downloadFile } from '../api/filesAPI';
import { decryptFile, formatFileSize } from '../crypto/fileEncryption';

interface FileAttachmentProps {
  /** Server file ID — used for server-hosted files */
  fileId?: string;
  /** Inline base64-encoded encrypted file data — used for inline files */
  fileData?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileKey: string;   // AES key (base64) — from the E2EE message content
  fileIv: string;    // IV (base64) — from the E2EE message content
  isSent: boolean;   // true if sent by current user
  /** If true, the file can only be downloaded once, then shows an expired message. */
  viewOnce?: boolean;
  /** Called after a view-once file has been downloaded. */
  onConsumed?: () => void;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function getFileIcon(mimeType: string): string {
  if (IMAGE_TYPES.has(mimeType)) return '\uD83D\uDDBC\uFE0F'; // framed picture
  if (mimeType === 'application/pdf') return '\uD83D\uDCC4';   // page facing up
  if (mimeType === 'text/plain' || mimeType === 'text/csv') return '\uD83D\uDCC3';
  if (mimeType === 'application/json') return '{ }';
  if (mimeType.includes('zip')) return '\uD83D\uDCE6';          // package
  if (mimeType.includes('word') || mimeType.includes('document')) return '\uD83D\uDCC4';
  return '\uD83D\uDCC1'; // file folder
}

const FileAttachment: React.FC<FileAttachmentProps> = ({
  fileId,
  fileData,
  fileName,
  mimeType,
  fileSize,
  fileKey,
  fileIv,
  isSent,
  viewOnce,
  onConsumed,
}) => {
  const [downloading, setDownloading] = useState(false);
  const [consumed, setConsumed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const hasAutoDecrypted = useRef(false);

  const isImage = IMAGE_TYPES.has(mimeType);
  const isInline = !!fileData;

  // Inject spin keyframe if not already present
  useEffect(() => {
    const styleId = 'frame-file-keyframes';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes frame-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  // Auto-decrypt images for preview (both inline and server-hosted)
  useEffect(() => {
    if (!isImage || hasAutoDecrypted.current) return;
    hasAutoDecrypted.current = true;

    void (async () => {
      try {
        let decryptedBytes: Uint8Array;
        if (isInline && fileData) {
          let decoded: string;
          try {
            decoded = atob(fileData);
          } catch {
            setError('File data is corrupted');
            return;
          }
          const encryptedBytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
          decryptedBytes = await decryptFile(encryptedBytes, fileKey, fileIv);
        } else if (fileId) {
          const encryptedBuffer = await downloadFile(fileId);
          decryptedBytes = await decryptFile(new Uint8Array(encryptedBuffer), fileKey, fileIv);
        } else {
          return;
        }
        const blob = new Blob([decryptedBytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setPreviewUrl(url);
      } catch (err) {
        console.error('[FileAttachment] Auto-decrypt image failed:', err);
      }
    })();
  }, [isImage, isInline, fileData, fileId, fileKey, fileIv, mimeType]);

  /** Decrypt inline data and return a Blob URL */
  const decryptInlineData = useCallback(async (): Promise<string> => {
    if (!fileData) throw new Error('No inline data');
    let decoded: string;
    try {
      decoded = atob(fileData);
    } catch {
      throw new Error('File data is corrupted');
    }
    const encryptedBytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    const decryptedBytes = await decryptFile(encryptedBytes, fileKey, fileIv);
    const blob = new Blob([decryptedBytes], { type: mimeType });
    return URL.createObjectURL(blob);
  }, [fileData, fileKey, fileIv, mimeType]);

  /** Decrypt server-hosted data and return a Blob URL */
  const decryptServerData = useCallback(async (): Promise<string> => {
    if (!fileId) throw new Error('No file ID');
    const encryptedBuffer = await downloadFile(fileId);
    const decryptedBytes = await decryptFile(
      new Uint8Array(encryptedBuffer),
      fileKey,
      fileIv,
    );
    const blob = new Blob([decryptedBytes], { type: mimeType });
    return URL.createObjectURL(blob);
  }, [fileId, fileKey, fileIv, mimeType]);

  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    setDownloadProgress(isInline ? 'Decrypting...' : 'Downloading...');

    try {
      let url: string;

      if (isInline) {
        url = await decryptInlineData();
      } else {
        setDownloadProgress('Downloading...');
        url = await decryptServerData();
      }

      // For images, show inline preview
      if (isImage) {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setPreviewUrl(url);
      }

      // Trigger browser download
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Don't revoke immediately for images (preview needs it)
      if (!isImage) {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      setDownloadProgress(null);
      if (viewOnce && !consumed) {
        setConsumed(true);
        onConsumed?.();
      }
    } catch (err) {
      console.error('[FileAttachment] Download/decrypt failed:', err);
      setError('Failed to download file');
      setDownloadProgress(null);
    } finally {
      setDownloading(false);
    }
  }, [downloading, isInline, isImage, fileName, decryptInlineData, decryptServerData, viewOnce, consumed, onConsumed]);

  if (consumed) {
    return (
      <div style={{
        ...containerStyle,
        backgroundColor: isSent ? 'rgba(255, 255, 255, 0.06)' : 'rgba(13, 17, 23, 0.5)',
      }}>
        <div style={fileInfoRowStyle}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>&#128065;</span>
          <span style={{ fontStyle: 'italic', color: '#8b949e', fontSize: 13 }}>File expired</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      ...containerStyle,
      backgroundColor: isSent ? 'rgba(255, 255, 255, 0.06)' : 'rgba(13, 17, 23, 0.5)',
    }}>
      {/* Image preview */}
      {previewUrl && isImage && (
        <div style={previewContainerStyle}>
          <img
            src={previewUrl}
            alt={fileName}
            style={previewImageStyle}
          />
        </div>
      )}

      {/* File info row — only shown when no image preview is available */}
      {!(previewUrl && isImage) && (
        <div style={fileInfoRowStyle}>
          <span style={fileIconStyle} aria-hidden="true">
            {getFileIcon(mimeType)}
          </span>
          <div style={fileDetailsStyle}>
            <div style={fileNameStyle} title={fileName}>
              {fileName}
            </div>
            <div style={fileSizeStyle}>
              {formatFileSize(fileSize)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { void handleDownload(); }}
            disabled={downloading}
            style={{
              ...downloadButtonStyle,
              opacity: downloading ? 0.5 : 1,
              cursor: downloading ? 'not-allowed' : 'pointer',
            }}
            title="Download file"
            aria-label={`Download ${fileName}`}
          >
            {downloading ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'frame-spin 1s linear infinite' }}>
                <circle cx="8" cy="8" r="6" stroke="#8b949e" strokeWidth="2" strokeDasharray="10 20" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
          </button>
        </div>
      )}

      {/* Progress indicator */}
      {downloadProgress && (
        <div style={progressStyle}>{downloadProgress}</div>
      )}

      {/* Error message */}
      {error && (
        <div style={errorStyle}>{error}</div>
      )}
    </div>
  );
};

export default FileAttachment;

// ── Styles ──

const containerStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 12,
  padding: 8,
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const previewContainerStyle: React.CSSProperties = {
  marginBottom: 8,
  borderRadius: 10,
  overflow: 'hidden',
  backgroundColor: 'rgba(0,0,0,0.15)',
  boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
};

const previewImageStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  width: 'auto',
  maxHeight: 240,
  objectFit: 'contain',
  borderRadius: 8,
};

const fileInfoRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const fileIconStyle: React.CSSProperties = {
  fontSize: 22,
  flexShrink: 0,
  lineHeight: 1,
  width: 32,
  textAlign: 'center',
};

const fileDetailsStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
};

const fileNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#e6edf3',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  lineHeight: 1.3,
};

const fileSizeStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#8b949e',
  marginTop: 2,
  lineHeight: 1,
};

const downloadButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  borderRadius: '50%',
  padding: 4,
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'background-color 0.15s, opacity 0.15s',
  backgroundColor: 'rgba(88, 166, 255, 0.12)',
};

const progressStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#58a6ff',
  marginTop: 6,
};

const errorStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#f85149',
  marginTop: 6,
};
