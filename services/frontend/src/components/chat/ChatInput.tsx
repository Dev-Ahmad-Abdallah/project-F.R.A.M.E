/* eslint-disable react/prop-types */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import VoiceRecorder from '../VoiceRecorder';
import CameraCapture from '../CameraCapture';
import { FILE_ACCEPT_STRING } from '../../api/filesAPI';
import { formatFileSize } from '../../crypto/fileEncryption';

// ── Emoji grid for picker ──
const CHAT_EMOJIS = [
  '\u{1F600}', '\u{1F602}', '\u{1F605}', '\u{1F609}', '\u{1F60D}', '\u{1F618}',
  '\u{1F970}', '\u{1F914}', '\u{1F923}', '\u{1F62D}', '\u{1F621}', '\u{1F631}',
  '\u{1F44D}', '\u{1F44E}', '\u{1F44B}', '\u{1F64F}', '\u{1F525}', '\u{2764}\u{FE0F}',
  '\u{1F389}', '\u{1F44F}', '\u{1F4AF}', '\u{1F440}', '\u{2705}', '\u{274C}',
];

const EMOJI_LABELS: Record<string, string> = {
  '\u{1F600}': 'Grinning face', '\u{1F602}': 'Laughing', '\u{1F605}': 'Sweat smile', '\u{1F609}': 'Wink',
  '\u{1F60D}': 'Heart eyes', '\u{1F618}': 'Blowing kiss', '\u{1F970}': 'Smiling with hearts',
  '\u{1F914}': 'Thinking', '\u{1F923}': 'Rolling on floor', '\u{1F62D}': 'Crying',
  '\u{1F621}': 'Angry', '\u{1F631}': 'Screaming', '\u{1F44D}': 'Thumbs up', '\u{1F44E}': 'Thumbs down',
  '\u{1F44B}': 'Waving hand', '\u{1F64F}': 'Pray', '\u{1F525}': 'Fire', '\u{2764}\u{FE0F}': 'Red heart',
  '\u{1F389}': 'Party', '\u{1F44F}': 'Clapping', '\u{1F4AF}': 'Hundred points', '\u{1F440}': 'Eyes',
  '\u{2705}': 'Check mark', '\u{274C}': 'Cross mark',
};

const INPUT_PLACEHOLDERS = [
  'Type a message...',
  'Say something encrypted...',
  'Your message is E2EE protected...',
  'Write a secure message...',
  "What's on your mind?",
];

export interface ChatInputProps {
  isMobile: boolean;
  isSending: boolean;
  inputValue: string;
  viewOnceMode: boolean;
  isUploadingFile: boolean;
  uploadStatus: string | null;
  replyTo: { eventId: string; senderId: string; body: string } | null;
  isAnonymous?: boolean;
  pendingFile: { file: File; previewUrl: string | null } | null;
  isRecordingVoice: boolean;
  voiceStream: MediaStream | null;
  showCamera: boolean;
  cameraStream: MediaStream | null;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onSendFile: () => void;
  onVoiceSend: (audioBase64: string, durationMs: number, mimeType?: string) => void;
  onCameraCapture: (file: File) => void;
  onSetViewOnceMode: (v: boolean) => void;
  onSetRecordingVoice: (v: boolean) => void;
  onSetVoiceStream: (s: MediaStream | null) => void;
  onSetShowCamera: (v: boolean) => void;
  onSetCameraStream: (s: MediaStream | null) => void;
  onCancelReply: () => void;
  onStageFile: (file: File) => void;
  onCancelPendingFile: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  showToast?: (type: 'success' | 'error' | 'info' | 'warning', message: string, options?: { persistent?: boolean; dedupeKey?: string; duration?: number }) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  getAvatarColor: (str: string) => string;
  /** When true, the other user in this DM has blocked the current user */
  isBlockedByUser?: boolean;
}

const ChatInput: React.FC<ChatInputProps> = React.memo(({
  isMobile,
  isSending,
  inputValue,
  viewOnceMode,
  isUploadingFile,
  uploadStatus,
  replyTo,
  isAnonymous,
  pendingFile,
  isRecordingVoice,
  voiceStream,
  showCamera,
  cameraStream,
  onInputChange,
  onKeyDown,
  onSend,
  onSendFile,
  onVoiceSend,
  onCameraCapture,
  onSetViewOnceMode,
  onSetRecordingVoice,
  onSetVoiceStream,
  onSetShowCamera,
  onSetCameraStream,
  onCancelReply,
  onStageFile,
  onCancelPendingFile,
  onFileSelect,
  showToast,
  textareaRef,
  getAvatarColor,
  isBlockedByUser,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [isTextareaFocused, setIsTextareaFocused] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMobileEmojiSheet, setShowMobileEmojiSheet] = useState(false);
  const [sendButtonAnimating, setSendButtonAnimating] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(() => Math.floor(Math.random() * 5));

  // Close emoji picker on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showEmojiPicker]);

  // Rotate placeholder text
  useEffect(() => {
    if (!isTextareaFocused || inputValue.length > 0) return;
    const timer = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % INPUT_PLACEHOLDERS.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [isTextareaFocused, inputValue]);

  // Re-focus textarea after send
  useEffect(() => {
    if (!isSending) {
      textareaRef.current?.focus();
    }
  }, [isSending, textareaRef]);

  const insertEmojiAtCursor = useCallback((emoji: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart ?? inputValue.length;
      const end = ta.selectionEnd ?? inputValue.length;
      const newVal = inputValue.slice(0, start) + emoji + inputValue.slice(end);
      // Simulate a change event through the native setter to trigger React's onChange
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) {
        setter.call(ta, newVal);
        const event = new Event('input', { bubbles: true });
        ta.dispatchEvent(event);
      }
      setTimeout(() => {
        ta.selectionStart = ta.selectionEnd = start + emoji.length;
        ta.focus();
      }, 0);
    }
    setShowEmojiPicker(false);
  }, [inputValue, textareaRef]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Check for pasted image files first
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]; // eslint-disable-line security/detect-object-injection
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        const f = item.getAsFile();
        if (f) {
          onStageFile(new File([f], `pasted-${Date.now()}.${f.type.split('/')[1] || 'png'}`, { type: f.type }));
        }
        return;
      }
    }
    // Text paste — warn if near limit
    const pastedText = e.clipboardData.getData('text');
    if (pastedText.length + inputValue.length > 15000) {
      showToast?.('warning', 'Pasted text was trimmed to fit the 15000 character limit', { duration: 4000 });
    }
  }, [inputValue, showToast, onStageFile]);

  const handleSendClick = useCallback(() => {
    setSendButtonAnimating(true);
    setTimeout(() => setSendButtonAnimating(false), 350);
    onSend();
  }, [onSend]);

  return (
    <>
      {/* Reply preview bar */}
      {replyTo && (
        <div className={isMobile ? 'frame-reply-preview-mobile' : ''} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: isMobile ? '6px 10px' : '8px 12px', borderTop: '1px solid #30363d', backgroundColor: '#1c2128' }}>
          <div style={{ flex: 1, borderLeft: `3px solid ${isAnonymous ? '#bc8cff' : getAvatarColor(replyTo.senderId)}`, paddingLeft: 8, overflow: 'hidden', minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#58a6ff', marginBottom: 1 }}>Replying to</div>
            <div style={{ fontSize: 12, color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{replyTo.body}</div>
          </div>
          <button type="button" style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', padding: 4, fontSize: 16, lineHeight: 1, fontFamily: 'inherit', flexShrink: 0, minWidth: 36, minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancelReply} aria-label="Cancel reply">&#10005;</button>
        </div>
      )}

      {/* Pending file preview bar */}
      {pendingFile && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12,
          padding: isMobile ? '8px 10px' : '10px 16px',
          borderTop: '1px solid #30363d', backgroundColor: '#161b22',
          animation: 'frame-overlay-fade-in 0.15s ease-out',
        }}>
          {pendingFile.previewUrl ? (
            <img
              src={pendingFile.previewUrl}
              alt={pendingFile.file.name}
              style={{ width: isMobile ? 40 : 48, height: isMobile ? 40 : 48, objectFit: 'cover', borderRadius: 8, border: '1px solid #30363d', flexShrink: 0 }}
            />
          ) : (
            <div style={{
              width: isMobile ? 40 : 48, height: isMobile ? 40 : 48, borderRadius: 8, border: '1px solid #30363d',
              backgroundColor: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <div style={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, color: '#c9d1d9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {pendingFile.file.name}
            </div>
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
              {formatFileSize(pendingFile.file.size)}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelPendingFile}
            style={{
              background: 'none', border: 'none', color: '#8b949e',
              cursor: 'pointer', padding: 8, borderRadius: '50%',
              fontFamily: 'inherit', flexShrink: 0,
              transition: 'color 0.15s, background-color 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 36, minHeight: 36,
            }}
            title="Remove attachment"
            aria-label="Remove attachment"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onSendFile}
            disabled={isUploadingFile}
            style={{
              padding: '8px 16px', borderRadius: 20,
              border: 'none', backgroundColor: '#238636',
              color: '#fff', fontSize: 13, fontWeight: 700, cursor: isUploadingFile ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              transition: 'background-color 0.15s, opacity 0.15s',
              flexShrink: 0, opacity: isUploadingFile ? 0.5 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              minHeight: 36,
            }}
          >
            {isUploadingFile ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: 'frame-spin 1s linear infinite' }}>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="14 14" />
                </svg>
                {uploadStatus || 'Sending...'}
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Send
              </>
            )}
          </button>
        </div>
      )}

      {/* Blocked by user — disabled input */}
      {isBlockedByUser ? (
        <div className="frame-chat-input-area" style={{ borderTop: '1px solid #30363d' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            flex: 1, backgroundColor: '#161b22', borderRadius: 24,
            border: '1px solid #30363d', padding: '12px 16px',
            opacity: 0.7,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f85149" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            <span style={{ fontSize: 13, color: '#8b949e', fontWeight: 500, userSelect: 'none' }}>
              You cannot message this user
            </span>
          </div>
        </div>
      ) : null}

      {/* Input area */}
      {isBlockedByUser ? null : isRecordingVoice ? (
        <div className="frame-chat-input-area" style={{ borderTop: '1px solid rgba(248,81,73,0.3)', backgroundColor: 'rgba(248,81,73,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, backgroundColor: '#0d1117', borderRadius: 24, border: '1px solid rgba(248,81,73,0.4)', padding: '4px 6px 4px 12px', gap: 4 }}>
            <VoiceRecorder
              onSend={(audio, dur, mime) => { onVoiceSend(audio, dur, mime); }}
              onCancel={() => { onSetRecordingVoice(false); onSetVoiceStream(null); }}
              stream={voiceStream}
            />
          </div>
        </div>
      ) : (
      <div className="frame-chat-input-area" style={{ borderTop: replyTo ? 'none' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', flex: 1, minWidth: 0, overflow: 'visible' as const, backgroundColor: '#0d1117', borderRadius: 24, border: isTextareaFocused ? '1px solid #3fb950' : '1px solid #30363d', transition: 'border-color 0.2s, box-shadow 0.2s', padding: '4px 6px 4px 12px', gap: 4, position: 'relative' as const, ...(isTextareaFocused ? { boxShadow: '0 0 0 2px rgba(63,185,80,0.1)' } : {}) }}>
          {/* File attachment */}
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_ACCEPT_STRING}
            style={{ display: 'none' }}
            onChange={onFileSelect}
          />
          <button
            type="button"
            title={isUploadingFile ? (uploadStatus || 'Uploading...') : 'Attach file'}
            aria-label={isUploadingFile ? (uploadStatus || 'Uploading...') : 'Attach file'}
            disabled={isUploadingFile}
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: isUploadingFile ? 'rgba(88,166,255,0.1)' : 'none',
              border: 'none',
              cursor: isUploadingFile ? 'not-allowed' : 'pointer',
              padding: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isUploadingFile ? 0.5 : 0.7,
              flexShrink: 0,
              alignSelf: 'flex-end',
              marginBottom: 1,
              borderRadius: '50%',
              transition: 'opacity 0.15s, background-color 0.15s',
              minWidth: 36,
              minHeight: 36,
            }}
          >
            {isUploadingFile ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ animation: 'frame-spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="9" stroke="#58a6ff" strokeWidth="2" strokeDasharray="14 14" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.49" /></svg>
            )}
          </button>
          {uploadStatus && (
            <span style={{ fontSize: 10, color: '#58a6ff', alignSelf: 'flex-end', marginBottom: 6, whiteSpace: 'nowrap' as const }}>{uploadStatus}</span>
          )}
          {/* Camera capture — available on all devices (desktop webcams + mobile cameras) */}
          <button
            type="button"
            title="Take photo"
            aria-label="Take photo"
            onClick={() => { void (async () => {
              if (!navigator.mediaDevices?.getUserMedia) {
                showToast?.('error', 'Camera not available in this browser. Try using HTTPS or a different browser.', { duration: 5000 });
                return;
              }
              try {
                (window as unknown as Record<string, unknown>).__framePermissionPending = true;
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: isMobile ? 'environment' : 'user' } });
                (window as unknown as Record<string, unknown>).__framePermissionPending = false;
                onSetCameraStream(stream);
                onSetShowCamera(true);
              } catch {
                (window as unknown as Record<string, unknown>).__framePermissionPending = false;
                showToast?.('error', 'Camera access denied. Check your browser permissions.', { duration: 5000 });
              }
            })(); }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: isMobile ? 8 : 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.7,
              flexShrink: 0,
              alignSelf: 'flex-end',
              marginBottom: 1,
              borderRadius: '50%',
              transition: 'opacity 0.15s, background-color 0.15s',
              minWidth: isMobile ? 44 : 32,
              minHeight: isMobile ? 44 : 32,
            }}
          >
            <svg width={isMobile ? '18' : '16'} height={isMobile ? '18' : '16'} viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
          {/* View-once toggle */}
          <button type="button" onClick={() => onSetViewOnceMode(!viewOnceMode)} title={viewOnceMode ? 'View-once enabled' : 'Enable view-once mode'} aria-label="Toggle view-once mode" style={{ background: viewOnceMode ? 'rgba(217,158,36,0.2)' : 'none', border: 'none', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 2 : 4, flexShrink: 0, alignSelf: 'flex-end', marginBottom: 1, borderRadius: '50%', transition: 'background-color 0.15s', minWidth: 36, minHeight: 36 }}>
            <svg width={isMobile ? '14' : '16'} height={isMobile ? '14' : '16'} viewBox="0 0 24 24" fill="none" stroke={viewOnceMode ? '#d99e24' : '#8b949e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            {viewOnceMode && !isMobile && <span style={{ fontSize: 10, fontWeight: 700, color: '#d99e24', letterSpacing: 0.3, whiteSpace: 'nowrap' as const }}>View Once</span>}
          </button>
          {/* Textarea */}
          {/* eslint-disable-next-line security/detect-object-injection */}
          <textarea ref={textareaRef} className="frame-chat-textarea" value={inputValue} onChange={onInputChange} onKeyDown={onKeyDown} onPaste={handlePaste} onFocus={() => setIsTextareaFocused(true)} onBlur={() => setIsTextareaFocused(false)} placeholder={viewOnceMode ? 'View-once message...' : INPUT_PLACEHOLDERS[placeholderIndex]} disabled={isSending} autoFocus aria-label="Message input" rows={1} maxLength={15000} />
          {/* Character count */}
          {inputValue.length > 13000 && (
            <span style={{ position: 'absolute' as const, bottom: 6, right: inputValue.trim() ? 88 : 44, fontSize: 10, color: inputValue.length > 14500 ? '#f85149' : inputValue.length > 14000 ? '#d29922' : '#8b949e', fontWeight: inputValue.length > 14500 ? 700 : 400, fontFamily: 'inherit', pointerEvents: 'none' as const, transition: 'color 0.2s' }} aria-live="polite">{inputValue.length}/15000</span>
          )}
          {/* Emoji picker */}
          <div ref={emojiPickerRef} style={{ position: 'relative' as const, flexShrink: 0, alignSelf: 'flex-end', marginBottom: 1 }}>
            <button type="button" onClick={() => { if (isMobile) { setShowMobileEmojiSheet((v) => !v); } else { setShowEmojiPicker((v) => !v); } }} title="Insert emoji" aria-label="Emoji picker" style={{ background: (showEmojiPicker || showMobileEmojiSheet) ? 'rgba(88,166,255,0.15)' : 'none', border: 'none', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', transition: 'background-color 0.15s', minWidth: 36, minHeight: 36 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={(showEmojiPicker || showMobileEmojiSheet) ? '#58a6ff' : '#8b949e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
            </button>
            {!isMobile && showEmojiPicker && (
              <div style={{ position: 'absolute' as const, bottom: 40, right: 0, backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 12, padding: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.45)', zIndex: 1000, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 2, width: 228 }}>
                {CHAT_EMOJIS.map((em) => (
                  // eslint-disable-next-line security/detect-object-injection
                  <button key={em} type="button" onClick={() => insertEmojiAtCursor(em)} aria-label={EMOJI_LABELS[em] || em} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', padding: 4, borderRadius: 6, lineHeight: 1.2, transition: 'background-color 0.1s' }} onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(88,166,255,0.15)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}>{em}</button>
                ))}
              </div>
            )}
          </div>
          {/* Mic button */}
          {!inputValue.trim() && (
            <button type="button" onClick={() => { void (async () => {
              if (!navigator.mediaDevices?.getUserMedia) {
                showToast?.('error', 'Microphone not available in this browser. Try using HTTPS or a different browser.', { duration: 5000 });
                return;
              }
              try {
                (window as unknown as Record<string, unknown>).__framePermissionPending = true;
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                (window as unknown as Record<string, unknown>).__framePermissionPending = false;
                onSetVoiceStream(stream);
                onSetRecordingVoice(true);
              } catch {
                (window as unknown as Record<string, unknown>).__framePermissionPending = false;
                showToast?.('error', 'Microphone access denied. Check your browser permissions.', { duration: 5000 });
              }
            })(); }} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-end', marginBottom: 1, borderRadius: '50%', transition: 'color 0.15s, background-color 0.15s', minWidth: 44, minHeight: 44 }} title="Record voice message" aria-label="Record voice message" onMouseEnter={(e) => { e.currentTarget.style.color = '#3fb950'; e.currentTarget.style.backgroundColor = 'rgba(63,185,80,0.1)'; }} onMouseLeave={(e) => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.backgroundColor = 'transparent'; }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
            </button>
          )}
          {/* Send button */}
          {inputValue.trim() && (
            <button style={{ padding: 8, borderRadius: '50%', border: 'none', backgroundColor: inputValue.length > 15000 ? '#6e3630' : '#238636', color: '#fff', cursor: (isSending || inputValue.length > 15000) ? 'not-allowed' : 'pointer', transition: 'background-color 0.15s, opacity 0.15s, transform 0.15s', alignSelf: 'flex-end', flexShrink: 0, marginBottom: 1, opacity: (isSending || inputValue.length > 15000) ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44, boxShadow: '0 2px 8px rgba(35, 134, 54, 0.3)', ...(sendButtonAnimating ? { animation: 'frame-send-launch 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' } : {}) }} onClick={handleSendClick} disabled={isSending || inputValue.length > 15000} aria-label="Send message">
              {isSending ? (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ animation: 'frame-spin 1s linear infinite' }}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="14 14" /></svg>) : (<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>)}
            </button>
          )}
        </div>
      </div>
      )}

      {/* Camera capture modal */}
      {showCamera && cameraStream && (
        <CameraCapture
          stream={cameraStream}
          onCapture={(file) => { onCameraCapture(file); }}
          onClose={() => { onSetShowCamera(false); onSetCameraStream(null); }}
        />
      )}

      {/* Mobile emoji bottom sheet */}
      {isMobile && showMobileEmojiSheet && (
        <>
          <div style={{ position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9998, animation: 'frame-overlay-fade-in 0.2s ease-out' }} onClick={() => setShowMobileEmojiSheet(false)} />
          <div style={{ position: 'fixed' as const, bottom: 0, left: 0, right: 0, backgroundColor: '#21262d', borderTop: '1px solid #30363d', borderRadius: '16px 16px 0 0', padding: '8px 12px', paddingBottom: 'env(safe-area-inset-bottom, 12px)', zIndex: 9999, animation: 'frame-bottom-sheet-slide-up 0.25s cubic-bezier(0.32, 0.72, 0, 1)', maxHeight: '45vh' }}>
            <div style={{ width: 36, height: 4, backgroundColor: '#484f58', borderRadius: 2, margin: '4px auto 8px' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: '#8b949e', padding: '4px 4px 8px', textAlign: 'center' as const }}>Emoji</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, padding: '8px 0' }}>
              {CHAT_EMOJIS.map((em) => (
                // eslint-disable-next-line security/detect-object-injection
                <button key={em} type="button" onClick={() => { insertEmojiAtCursor(em); setShowMobileEmojiSheet(false); }} aria-label={EMOJI_LABELS[em] || em} style={{ background: 'none', border: 'none', fontSize: 26, cursor: 'pointer', padding: 8, borderRadius: 10, lineHeight: 1.2, minHeight: 48, minWidth: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{em}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
});

ChatInput.displayName = 'ChatInput';

export default ChatInput;
