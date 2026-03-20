/* eslint-disable react/prop-types */
import React from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../../utils/purifyConfig';
import { formatDisplayName } from '../../utils/displayName';
import { linkifyText, isEmojiOnly, isFileMessage, isAudioMessage, getFileContent, getAudioContent } from '../../utils/messageFormatting';
import type { DecryptedEvent } from '../../crypto/sessionManager';
import type { ReactionData } from '../../api/messagesAPI';
import AudioPlayer from '../AudioPlayer';
import FileAttachment from '../FileAttachment';
import { styles } from './chatStyles';

// ── Avatar color helper ──
const AVATAR_COLORS = ['#da3633', '#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f78166'];

export function getAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Format a date as a human-friendly relative timestamp.
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  const timeStr = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (msgDay.getTime() === today.getTime()) return `Today ${timeStr}`;
  if (msgDay.getTime() === yesterday.getTime()) return `Yesterday ${timeStr}`;

  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  }) + ', ' + timeStr;
}

/**
 * Format full timestamp for tooltip display.
 */
export function formatFullTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Format a date separator label ("Today", "Yesterday", "March 15").
 */
export function formatDateSeparator(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (msgDay.getTime() === today.getTime()) return 'Today';
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';

  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

/**
 * Check if two dates are on different calendar days.
 */
export function isDifferentDay(a: Date | string, b: Date | string): boolean {
  const da = typeof a === 'string' ? new Date(a) : a;
  const db = typeof b === 'string' ? new Date(b) : b;
  return da.getFullYear() !== db.getFullYear() ||
    da.getMonth() !== db.getMonth() ||
    da.getDate() !== db.getDate();
}

/**
 * Render the text content of a decrypted event.
 */
export function renderMessageContent(decrypted: DecryptedEvent): string {
  if (decrypted.decryptionError) return 'Unable to decrypt';
  const content = decrypted.plaintext;
  if (!content) return 'Unable to decrypt';
  const raw =
    typeof content.body === 'string'
      ? content.body
      : typeof content.ciphertext === 'string'
        ? content.ciphertext
        : JSON.stringify(content);
  return DOMPurify.sanitize(raw, PURIFY_CONFIG);
}

// ── Self-Destruct Countdown Badge ──

export function DisappearingCountdownBadge({ msgTimestamp, timeoutSeconds, enabled, isExpired }: {
  msgTimestamp: number;
  timeoutSeconds: number;
  enabled: boolean;
  isExpired: boolean;
}) {
  const [secondsLeft, setSecondsLeft] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!enabled || isExpired) {
      setSecondsLeft(null);
      return;
    }
    const calc = () => {
      const remaining = Math.max(0, Math.ceil((msgTimestamp + timeoutSeconds * 1000 - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };
    calc();
    const timer = setInterval(calc, 1000);
    return () => clearInterval(timer);
  }, [msgTimestamp, timeoutSeconds, enabled, isExpired]);

  if (secondsLeft === null || secondsLeft <= 0) return null;

  const isUrgent = secondsLeft <= 10;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '1px 5px', fontSize: 9, fontWeight: 700,
      fontFamily: 'monospace', letterSpacing: '0.05em',
      borderRadius: 4,
      backgroundColor: isUrgent ? 'rgba(248, 81, 73, 0.15)' : 'rgba(210, 153, 34, 0.12)',
      color: isUrgent ? '#f85149' : '#d29922',
      border: `1px solid ${isUrgent ? 'rgba(248, 81, 73, 0.3)' : 'rgba(210, 153, 34, 0.25)'}`,
      marginLeft: 4,
    }}>
      {'\u{1F4A3}'} {secondsLeft}s
    </span>
  );
}

// ── Cipher Typing Indicator ──
const CIPHER_CHARS = '!@#$%^&*()_+-=[]{}|;:<>?/~0123456789ABCDEFabcdef';

export function CipherTypingIndicator({ displayName }: { displayName: string }) {
  const [text, setText] = React.useState('');
  const [animKey, setAnimKey] = React.useState(0);
  const target = `${displayName} is typing`;

  React.useEffect(() => {
    setAnimKey((k) => k + 1);
  }, [displayName]);

  React.useEffect(() => {
    let frame = 0;
    const maxFrames = target.length * 3;
    setText('');
    const interval = setInterval(() => {
      frame++;
      const resolved = Math.floor(frame / 3);
      let result = '';
      for (let i = 0; i < target.length; i++) {
        if (i < resolved) {
          result += target[i];
        } else if (target[i] === ' ') {
          result += ' ';
        } else {
          result += CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)];
        }
      }
      setText(result);
      if (frame >= maxFrames) {
        clearInterval(interval);
      }
    }, 40);
    return () => clearInterval(interval);
  }, [animKey, target]);

  return (
    <span style={{
      display: 'inline-block',
      fontFamily: 'monospace',
      color: '#3fb950',
      fontSize: 12,
      letterSpacing: 1,
      backgroundColor: 'rgba(63,185,80,0.08)',
      border: '1px solid rgba(63,185,80,0.2)',
      borderRadius: 12,
      padding: '4px 10px',
    }}>
      {text}
      <span style={{ animation: 'frame-cursor-blink 1s step-end infinite' }}>_</span>
    </span>
  );
}

// ── MessageBubble Props ──

export interface MessageBubbleProps {
  decrypted: DecryptedEvent;
  isOwn: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  isDeleted: boolean;
  isExpired: boolean;
  isSelfDestructing: boolean;
  isViewOnce: boolean;
  hasPopIn: boolean;
  hasError: boolean;
  isMobile: boolean;
  isAnonymous?: boolean;
  currentUserId: string;
  resolveDisplayName: (senderId: string, senderDisplayName?: string) => string;
  disappearingSettings: { enabled: boolean; timeoutSeconds: number } | null;
  readReceiptMap: Record<string, { readAt: string }>;
  localReactions: Record<string, Record<string, ReactionData>>;
  searchQuery: string;
  searchMatchIndex: number;
  filteredMessages: DecryptedEvent[];
  onContextMenu: (e: React.MouseEvent, eventId: string, senderId: string) => void;
  onClick: (e: React.MouseEvent, eventId: string) => void;
  onReply: (eventId: string) => void;
  onReact: (eventId: string, emoji: string) => void;
  onShowReactionPicker: (e: React.MouseEvent, eventId: string) => void;
  onScrollToMessage: (eventId: string) => void;
  onTouchStart?: (eventId: string, senderId: string) => void;
  onTouchEnd?: () => void;
  onTouchMove?: () => void;
  onConsumedOnce?: (eventId: string) => void;
  messageRef: (el: HTMLDivElement | null) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({
  decrypted,
  isOwn,
  isFirstInGroup,
  isLastInGroup,
  isDeleted,
  isExpired,
  isSelfDestructing,
  isViewOnce,
  hasPopIn,
  hasError,
  isMobile,
  isAnonymous,
  currentUserId,
  resolveDisplayName,
  disappearingSettings,
  readReceiptMap,
  localReactions,
  searchQuery,
  searchMatchIndex,
  filteredMessages,
  onContextMenu,
  onClick,
  onReply,
  onReact,
  onShowReactionPicker,
  onScrollToMessage,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
  onConsumedOnce,
  messageRef,
}) => {
  const event = decrypted.event;
  const msgDate = new Date(event.originServerTs);

  const bubbleRadius = isOwn
    ? { borderTopLeftRadius: 16, borderTopRightRadius: isFirstInGroup ? 16 : 4, borderBottomLeftRadius: 16, borderBottomRightRadius: isLastInGroup ? 4 : 4 }
    : { borderTopLeftRadius: isFirstInGroup ? 16 : 4, borderTopRightRadius: 16, borderBottomLeftRadius: isLastInGroup ? 4 : 4, borderBottomRightRadius: 16 };

  const isCurrentSearchMatch = searchQuery.trim() && filteredMessages.length > 0 && searchMatchIndex < filteredMessages.length && filteredMessages[searchMatchIndex]?.event.eventId === event.eventId;

  return (
    <div
      ref={messageRef}
      className="frame-msg-row"
      style={{
        display: 'flex', alignItems: 'flex-end', gap: 8,
        alignSelf: isOwn ? 'flex-end' : 'flex-start',
        maxWidth: isMobile ? '85%' : 'clamp(180px, 65%, 480px)',
        marginTop: isFirstInGroup ? 8 : 2,
        position: 'relative' as const,
        ...(isSelfDestructing ? { animation: 'frame-self-destruct 0.8s ease-in forwards', overflow: 'hidden' as const } : hasPopIn ? { animation: 'frame-msg-pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' } : {}),
        ...(isCurrentSearchMatch ? { outline: '2px solid rgba(210, 153, 34, 0.7)', outlineOffset: 2, borderRadius: 12 } : {}),
      }}
      onTouchStart={isMobile && onTouchStart ? () => onTouchStart(event.eventId, event.senderId) : undefined}
      onTouchEnd={isMobile ? onTouchEnd : undefined}
      onTouchMove={isMobile ? onTouchMove : undefined}
    >
      {!isOwn && (
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          backgroundColor: isFirstInGroup ? (isAnonymous ? '#6e40aa' : getAvatarColor(event.senderId)) : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 600, color: '#fff', flexShrink: 0,
          visibility: isFirstInGroup ? ('visible' as const) : ('hidden' as const),
        }}>
          {isFirstInGroup ? (isAnonymous ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </svg>
          ) : formatDisplayName(event.senderId).charAt(0).toUpperCase()) : ''}
        </div>
      )}
      <div
        className="frame-msg-bubble"
        style={{ ...styles.messageBubble, ...(isMobile ? { padding: '10px 14px', fontSize: 'clamp(14px, 3.8vw, 16px)' } : {}), ...(isOwn ? styles.ownMessage : styles.otherMessage), ...(hasError ? styles.previousSessionMessage : {}), ...bubbleRadius, marginTop: 0, position: 'relative' as const }}
        onContextMenu={isMobile ? undefined : (e) => onContextMenu(e, event.eventId, event.senderId)}
        onClick={(e) => onClick(e, event.eventId)}
      >
        {/* Reply quote block */}
        {decrypted.plaintext != null && Boolean(decrypted.plaintext.replyTo) && (() => {
          const rt = decrypted.plaintext.replyTo as { eventId: string; senderId: string; body: string };
          return (
            <div
              className="frame-reply-quote"
              style={{ borderLeft: `3px solid ${isOwn ? 'rgba(255,255,255,0.5)' : '#58a6ff'}`, backgroundColor: isOwn ? 'rgba(255,255,255,0.08)' : 'rgba(88,166,255,0.06)', borderRadius: '0 8px 8px 0', padding: '6px 10px', marginBottom: 6, marginTop: 0, cursor: 'pointer', maxWidth: '100%', overflow: 'hidden', transition: 'background-color 0.15s' }}
              onClick={(e) => { e.stopPropagation(); onScrollToMessage(rt.eventId); }}
              title="Click to scroll to original message"
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: isOwn ? 'rgba(255,255,255,0.85)' : '#58a6ff', marginBottom: 2, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                {DOMPurify.sanitize(isAnonymous ? 'Anonymous' : formatDisplayName(rt.senderId), PURIFY_CONFIG)}
              </div>
              <div className="frame-reply-quote-text" style={{ fontSize: 13, color: isOwn ? 'rgba(255,255,255,0.6)' : '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, lineHeight: 1.4, wordBreak: 'break-word' as const }}>
                {typeof rt.body === 'string' ? DOMPurify.sanitize(rt.body, PURIFY_CONFIG) : 'Message'}
              </div>
            </div>
          );
        })()}
        {!isOwn && isFirstInGroup && (
          <div style={{ ...styles.senderName, color: isAnonymous ? '#bc8cff' : getAvatarColor(event.senderId) }}>
            {DOMPurify.sanitize(resolveDisplayName(event.senderId, event.senderDisplayName), PURIFY_CONFIG)}
          </div>
        )}
        <div style={styles.messageBody}>
          {isDeleted ? (
            <span style={styles.deletedText}>This message was deleted</span>
          ) : isExpired ? (
            <span style={styles.expiredText}>Message expired</span>
          ) : (
            <>
              {isViewOnce && <span style={styles.viewOnceIcon} title="View-once message">&#128065;</span>}
              {hasError ? (
                <span style={styles.previousSessionInline}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                    <circle cx="7" cy="7" r="6" stroke="#8b949e" strokeWidth="1.2" fill="rgba(139,148,158,0.10)" />
                    <rect x="5" y="6.5" width="4" height="3.2" rx="0.6" stroke="#8b949e" strokeWidth="0.9" fill="none" />
                    <path d="M6 6.5V5.2a1 1 0 0 1 2 0V6.5" stroke="#8b949e" strokeWidth="0.9" strokeLinecap="round" fill="none" />
                  </svg>
                  <span style={styles.previousSessionText} title="This message was encrypted with keys from a different session. It cannot be decrypted on this device.">
                    Message from a previous session
                  </span>
                  <span
                    style={styles.previousSessionInfoIcon}
                    title="End-to-end encrypted messages use session keys unique to each login. When you sign in on a new device or session, older messages cannot be decrypted. This protects forward secrecy."
                  >
                    i
                  </span>
                </span>
              ) : (
                decrypted.plaintext && isFileMessage(decrypted.plaintext)
                ? (() => {
                    const fc = getFileContent(decrypted.plaintext);
                    return fc ? (
                      <FileAttachment
                        fileId={fc.fileId}
                        fileData={fc.fileData}
                        fileName={fc.fileName}
                        mimeType={fc.mimeType}
                        fileSize={fc.fileSize}
                        fileKey={fc.fileKey}
                        fileIv={fc.fileIv}
                        isSent={isOwn}
                        viewOnce={isViewOnce || undefined}
                        onConsumed={isViewOnce && onConsumedOnce ? () => onConsumedOnce(event.eventId) : undefined}
                      />
                    ) : null;
                  })()
                : decrypted.plaintext && isAudioMessage(decrypted.plaintext)
                ? (() => {
                    const audio = getAudioContent(decrypted.plaintext);
                    return audio ? (
                      <AudioPlayer
                        audioBase64={audio.audioData}
                        durationMs={audio.duration}
                        isSent={isOwn}
                        mimeType={audio.mimeType}
                        viewOnce={isViewOnce || undefined}
                        onConsumed={isViewOnce && onConsumedOnce ? () => onConsumedOnce(event.eventId) : undefined}
                      />
                    ) : null;
                  })()
                : <span className={isOwn ? 'frame-msg-text-own' : 'frame-msg-text'} style={(() => {
                    const t = renderMessageContent(decrypted);
                    if (isEmojiOnly(t)) return { fontSize: 32, lineHeight: 1.3, textAlign: 'center' as const, display: 'block', padding: 0 };
                    return {};
                  })()}>{(() => {
                    const text = renderMessageContent(decrypted);
                    if (!searchQuery.trim()) return linkifyText(text, isOwn);
                    const q = searchQuery.toLowerCase();
                    const lower = text.toLowerCase();
                    if (!lower.includes(q)) return linkifyText(text, isOwn);
                    const isCurrentMatch = filteredMessages.length > 0 &&
                      searchMatchIndex < filteredMessages.length &&
                      filteredMessages[searchMatchIndex]?.event.eventId === event.eventId;
                    const parts: React.ReactNode[] = [];
                    let cursor = 0;
                    let matchPos = lower.indexOf(q, cursor);
                    let partKey = 0;
                    while (matchPos !== -1) {
                      if (matchPos > cursor) {
                        parts.push(<span key={`st-${partKey++}`}>{text.slice(cursor, matchPos)}</span>);
                      }
                      parts.push(
                        <mark key={`sm-${partKey++}`} style={{
                          backgroundColor: isCurrentMatch ? 'rgba(210, 153, 34, 0.8)' : 'rgba(210, 153, 34, 0.35)',
                          color: 'inherit',
                          borderRadius: 2,
                        }}>{text.slice(matchPos, matchPos + searchQuery.length)}</mark>
                      );
                      cursor = matchPos + searchQuery.length;
                      matchPos = lower.indexOf(q, cursor);
                    }
                    if (cursor < text.length) {
                      parts.push(<span key={`st-${partKey}`}>{text.slice(cursor)}</span>);
                    }
                    return parts;
                  })()}</span>
              )}
            </>
          )}
        </div>
        {isLastInGroup && (
          <div style={styles.timestampRow}>
            <span style={styles.timestamp} title={formatFullTimestamp(event.originServerTs)}>{formatRelativeTime(event.originServerTs)}</span>
            {isOwn && (() => {
              const evId = event.eventId;
              // eslint-disable-next-line security/detect-object-injection
              const receipt = readReceiptMap[evId];
              if (receipt) {
                return <span style={{ ...styles.readReceiptIcon, color: '#58a6ff', opacity: 1 }} title={`Read${receipt.readAt ? ' at ' + formatFullTimestamp(receipt.readAt) : ''}`}>{'\u2713\u2713'}</span>;
              }
              return <span style={styles.readReceiptIcon} title="Sent">{'\u2713'}</span>;
            })()}
            {disappearingSettings?.enabled && !isDeleted && !isExpired && (
              <DisappearingCountdownBadge
                msgTimestamp={new Date(event.originServerTs).getTime()}
                timeoutSeconds={disappearingSettings.timeoutSeconds}
                enabled={true}
                isExpired={isExpired}
              />
            )}
          </div>
        )}
        {(() => {
          const reactions = localReactions[event.eventId] || event.reactions || {};
          const emojiKeys = Object.keys(reactions);
          if (emojiKeys.length === 0) return null;
          return (
            <div style={styles.reactionsRow}>
              {emojiKeys.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="frame-reaction-badge"
                  // eslint-disable-next-line security/detect-object-injection
                  style={{ ...styles.reactionBadge, ...(isMobile ? { padding: '1px 5px', fontSize: 11, gap: 2 } : {}), ...(reactions[emoji].users.includes(currentUserId) ? styles.reactionBadgeOwn : {}) }}
                  onClick={() => void onReact(event.eventId, emoji)}
                  // eslint-disable-next-line security/detect-object-injection
                  title={reactions[emoji].users.map((u: string) => formatDisplayName(u)).join(', ')}
                >
                  {/* eslint-disable-next-line security/detect-object-injection */}
                  {emoji} {reactions[emoji].count}
                </button>
              ))}
            </div>
          );
        })()}
      </div>
      {!isDeleted && !isExpired && !hasError && (
        <div className="frame-msg-hover-actions" style={{
          position: 'absolute' as const,
          top: -6,
          ...(isOwn ? { left: -40 } : { right: -40 }),
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          opacity: 0,
          transition: 'opacity 0.15s',
          pointerEvents: 'auto' as const,
        }}>
          <button
            type="button"
            className="frame-msg-hover-action"
            style={styles.hoverActionButton}
            onClick={() => onReply(event.eventId)}
            title="Reply"
            aria-label="Reply"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 17 4 12 9 7"></polyline>
              <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
            </svg>
          </button>
          <button
            type="button"
            className="frame-msg-hover-action"
            style={styles.hoverActionButton}
            onClick={(e) => onShowReactionPicker(e, event.eventId)}
            title="Add reaction"
            aria-label="Add reaction"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
});

MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;
