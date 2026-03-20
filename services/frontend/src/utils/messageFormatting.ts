/**
 * Message formatting utilities for F.R.A.M.E.
 *
 * Extracted from ChatWindow.tsx so they can be tested independently
 * and reused across components.
 *
 * Provides: URL sanitization, URL truncation, markdown-lite parsing,
 * inline formatting (bold, italic, code, strikethrough), and linkification.
 */

import React from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from './purifyConfig';

/** Regex to detect URLs in text. */
export const URL_REGEX = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

/**
 * Sanitize a URL — only allow http/https protocols.
 * Returns null for dangerous protocols (javascript:, data:, etc.).
 */
export function sanitizeUrl(raw: string): string | null {
  let url = raw;
  if (url.startsWith('www.')) url = 'https://' + url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Truncate a display URL: show first 40 chars + ellipsis for long URLs.
 */
export function truncateUrl(url: string): string {
  if (url.length <= 50) return url;
  return url.slice(0, 40) + '\u2026';
}

/**
 * Parse markdown-lite formatting tokens in a text segment into React elements.
 * Supports: ```code blocks```, `inline code`, **bold** / *bold*, __italic__ / _italic_,
 * ~~strikethrough~~ / ~strikethrough~.
 */
export function parseMarkdownLite(text: string, isOwn: boolean): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  const codeBlockRegex = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(...parseInlineFormatting(text.slice(lastIndex, match.index), isOwn));
    }
    elements.push(
      React.createElement('pre', {
        key: `cb-${match.index}`,
        style: {
          backgroundColor: isOwn ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.3)',
          color: '#e6edf3',
          padding: '8px 10px',
          borderRadius: 6,
          fontSize: 13,
          fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
          overflowX: 'auto' as const,
          margin: '4px 0',
          whiteSpace: 'pre-wrap' as const,
          wordBreak: 'break-word' as const,
        },
      }, match[1])
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    elements.push(...parseInlineFormatting(text.slice(lastIndex), isOwn));
  }
  return elements;
}

/**
 * Parse inline formatting: `code`, **bold**, *bold*, __italic__, _italic_, ~~strike~~, ~strike~.
 */
export function parseInlineFormatting(text: string, isOwn: boolean): React.ReactNode[] {
  const inlineRegex = /(`([^`]+?)`|\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|_(.+?)_|~~(.+?)~~|~(.+?)~)/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }
    const key = `fmt-${match.index}`;
    if (match[2] !== undefined) {
      elements.push(React.createElement('code', {
        key,
        style: {
          backgroundColor: isOwn ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.3)',
          color: '#e6edf3',
          padding: '1px 5px',
          borderRadius: 3,
          fontSize: '0.9em',
          fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
        },
      }, match[2]));
    } else if (match[3] !== undefined) {
      elements.push(React.createElement('strong', { key }, match[3]));
    } else if (match[4] !== undefined) {
      elements.push(React.createElement('strong', { key }, match[4]));
    } else if (match[5] !== undefined) {
      elements.push(React.createElement('em', { key }, match[5]));
    } else if (match[6] !== undefined) {
      elements.push(React.createElement('em', { key }, match[6]));
    } else if (match[7] !== undefined) {
      elements.push(React.createElement('s', { key }, match[7]));
    } else if (match[8] !== undefined) {
      elements.push(React.createElement('s', { key }, match[8]));
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }
  return elements;
}

/**
 * linkifyText: split text by URLs, apply markdown formatting to non-URL parts,
 * and render URLs as clickable <a> tags. Returns React elements.
 */
export function linkifyText(text: string, isOwn: boolean): React.ReactNode[] {
  const sanitized = DOMPurify.sanitize(text, PURIFY_CONFIG);
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(URL_REGEX.source, 'gi');

  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(sanitized)) !== null) {
    if (match.index > lastIndex) {
      elements.push(...parseMarkdownLite(sanitized.slice(lastIndex, match.index), isOwn));
    }
    const rawUrl = match[0];
    const href = sanitizeUrl(rawUrl);
    if (href) {
      elements.push(
        React.createElement('a', {
          key: `link-${match.index}`,
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
          style: {
            color: isOwn ? 'rgba(255,255,255,0.95)' : '#58a6ff',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            wordBreak: 'break-all' as const,
          },
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
        }, truncateUrl(rawUrl))
      );
    } else {
      elements.push(rawUrl);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < sanitized.length) {
    elements.push(...parseMarkdownLite(sanitized.slice(lastIndex), isOwn));
  }
  return elements;
}

/**
 * Check if a string is emoji-only (up to 10 emoji characters).
 */
export function isEmojiOnly(text: string): boolean {
  const emojiOnly = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]{1,10}$/u;
  return emojiOnly.test(text.trim()) && text.trim().length <= 12;
}

/**
 * Parse content that may be a string (JSON) or already an object.
 */
export function parseContentIfString(content: unknown): Record<string, unknown> | null {
  if (content != null && typeof content === 'object') {
    return content as Record<string, unknown>;
  }
  if (typeof content === 'string') {
    try {
      const parsed: unknown = JSON.parse(content);
      if (parsed != null && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not valid JSON — return null
    }
  }
  return null;
}

/**
 * Check if the content represents an audio message.
 */
export function isAudioMessage(content: unknown): boolean {
  const obj = parseContentIfString(content);
  return obj != null && obj.msgtype === 'm.audio' && typeof obj.audioData === 'string';
}

/**
 * Check if the content represents a file message.
 */
export function isFileMessage(content: unknown): boolean {
  const obj = parseContentIfString(content);
  if (obj == null) return false;
  const mt = obj.msgtype;
  if (mt !== 'm.file' && mt !== 'm.image') return false;
  return typeof obj.fileId === 'string' || typeof obj.fileData === 'string';
}

/**
 * Extract audio content data from a message.
 */
export function getAudioContent(content: unknown): { audioData: string; duration: number; mimeType?: string } | null {
  const obj = parseContentIfString(content);
  if (obj != null && obj.msgtype === 'm.audio' && typeof obj.audioData === 'string') {
    return {
      audioData: String(obj.audioData),
      duration: Number(obj.duration) || 0,
      mimeType: typeof obj.audioMimeType === 'string' ? String(obj.audioMimeType) : undefined,
    };
  }
  return null;
}

/**
 * Extract file content data from a message.
 */
export function getFileContent(content: unknown): {
  fileId?: string; fileData?: string; fileName: string; mimeType: string;
  fileSize: number; fileKey: string; fileIv: string;
} | null {
  const obj = parseContentIfString(content);
  if (obj == null) return null;
  const mt = obj.msgtype;
  if (mt !== 'm.file' && mt !== 'm.image') return null;
  const hasFileId = typeof obj.fileId === 'string';
  const hasFileData = typeof obj.fileData === 'string';
  if (!hasFileId && !hasFileData) return null;
  if (typeof obj.fileKey !== 'string' || typeof obj.fileIv !== 'string') return null;
  return {
    fileId: hasFileId ? String(obj.fileId) : undefined,
    fileData: hasFileData ? String(obj.fileData) : undefined,
    fileName: typeof obj.fileName === 'string' ? String(obj.fileName)
      : typeof obj.filename === 'string' ? String(obj.filename)
      : typeof obj.body === 'string' ? String(obj.body) : 'file',
    mimeType: typeof obj.mimeType === 'string' ? String(obj.mimeType) : 'application/octet-stream',
    fileSize: typeof obj.fileSize === 'number' ? Number(obj.fileSize) : 0,
    fileKey: String(obj.fileKey),
    fileIv: String(obj.fileIv),
  };
}
