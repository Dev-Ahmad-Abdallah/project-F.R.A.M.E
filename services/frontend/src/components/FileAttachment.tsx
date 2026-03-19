/**
 * FileAttachment — renders a file attachment inside a chat message bubble.
 *
 * Shows file icon, name, size, and a download button. On click, downloads
 * the encrypted blob from the server, decrypts it client-side using the
 * AES key from the E2EE message, and triggers a browser save dialog.
 *
 * For image types, shows an inline thumbnail preview after decryption.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { downloadFile } from '../api/filesAPI';
import { decryptFile, formatFileSize } from '../crypto/fileEncryption';

interface FileAttachmentProps {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileKey: string;   // AES key (base64) — from the E2EE message content
  fileIv: string;    // IV (base64) — from the E2EE message content
  isSent: boolean;   // true if sent by current user
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function getFileIcon(mimeType: string): string {
  if (IMAGE_TYPES.has(mimeType)) return '\uD83D\uDDBC\uFE0F'; // framed picture
  if (mimeType === 'application/pdf') return '\uD83D\uDCC4';   // page facing up
  if (mimeType === 'text/plain') return '\uD83D\uDCC3';        // page with curl
  if (mimeType.includes('word') || mimeType.includes('document')) return '\uD83D\uDCC4';
  return '\uD83D\uDCC1'; // file folder
}

const FileAttachment: React.FC<FileAttachmentProps> = ({
  fileId,
  fileName,
  mimeType,
  fileSize,
  fileKey,
  fileIv,
  isSent,
}) => {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const isImage = IMAGE_TYPES.has(mimeType);

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

  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    setDownloadProgress('Downloading...');

    try {
      const encryptedBuffer = await downloadFile(fileId);
      setDownloadProgress('Decrypting...');

      const decryptedBytes = await decryptFile(
        new Uint8Array(encryptedBuffer),
        fileKey,
        fileIv,
      );

      const blob = new Blob([decryptedBytes], { type: mimeType });
      const url = URL.createObjectURL(blob);

      // For images, show inline preview
      if (isImage) {
        // Revoke previous preview if any
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }
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
    } catch (err) {
      console.error('[FileAttachment] Download/decrypt failed:', err);
      setError('Failed to download file');
      setDownloadProgress(null);
    } finally {
      setDownloading(false);
    }
  }, [downloading, fileId, fileKey, fileIv, fileName, mimeType, isImage]);

  return (
    <div style={{
      ...containerStyle,
      backgroundColor: isSent ? 'rgba(88, 166, 255, 0.08)' : '#161b22',
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

      {/* File info row */}
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
  border: '1px solid #30363d',
  borderRadius: 12,
  padding: 10,
  maxWidth: 320,
  minWidth: 200,
};

const previewContainerStyle: React.CSSProperties = {
  marginBottom: 8,
  borderRadius: 8,
  overflow: 'hidden',
  backgroundColor: '#0d1117',
};

const previewImageStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  maxHeight: 200,
  objectFit: 'contain',
  borderRadius: 8,
};

const fileInfoRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const fileIconStyle: React.CSSProperties = {
  fontSize: 24,
  flexShrink: 0,
  lineHeight: 1,
};

const fileDetailsStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
};

const fileNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#c9d1d9',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const fileSizeStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#8b949e',
  marginTop: 1,
};

const downloadButtonStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'background-color 0.15s, opacity 0.15s',
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
