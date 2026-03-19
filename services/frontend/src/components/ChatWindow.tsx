import React, { useState, useEffect, useRef, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { sendMessage, deleteMessage, syncMessages, SyncEvent } from '../api/messagesAPI';
import { renameRoom } from '../api/roomsAPI';
import { formatDisplayName } from '../utils/displayName';
import {
  encryptForRoom,
  decryptEvent,
  processSyncResponse,
  DecryptedEvent,
} from '../crypto/sessionManager';
import { FONT_BODY } from '../globalStyles';
import { useIsMobile } from '../hooks/useIsMobile';

// ── Helpers ──

/**
 * Format a date as a human-friendly relative timestamp.
 * - < 60s  -> "just now"
 * - < 60m  -> "2 min ago"
 * - < 24h  -> "1 hour ago"
 * - same day -> "Today 3:45 PM"
 * - yesterday -> "Yesterday 3:45 PM"
 * - older -> "Mar 14, 3:45 PM"
 */
function formatRelativeTime(date: Date | string): string {
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

// ── Types ──

type MessageSendStatus = 'sending' | 'sent' | 'failed';

interface OptimisticMessage {
  id: string;
  body: string;
  timestamp: number;
  status: MessageSendStatus;
  viewOnce?: boolean;
}

interface ChatWindowProps {
  roomId: string;
  currentUserId: string;
  /** User IDs of all room members (including current user) */
  memberUserIds: string[];
  /** Display name for the room (used in the header) */
  roomDisplayName?: string;
  /** Room type: direct or group */
  roomType?: 'direct' | 'group';
  /** Number of members in the room */
  memberCount?: number;
  /** Callback when the info button is clicked to open room settings */
  onOpenSettings?: () => void;
  /** Callback when the room is renamed via inline edit */
  onRoomRenamed?: (roomId: string, newName: string) => void;
  /** Callback when the user wants to leave the conversation */
  onLeave?: () => void;
  // E2EE is always enabled — no plaintext bypass allowed (Security Finding 1)
}

/**
 * Chat UI component with Megolm group encryption.
 *
 * - Encrypts outgoing messages via encryptForRoom()
 * - Decrypts incoming events via decryptEvent()
 * - Shows encryption status per message (lock / warning icons)
 * - Handles decryption failures gracefully
 * - Sanitises all rendered content via DOMPurify
 * - Shows relative timestamps ("just now", "2 min ago", etc.)
 * - Optimistic send with status indicators (sending / sent / failed)
 * - Room header with name, member count, and info button
 */
const ChatWindow: React.FC<ChatWindowProps> = ({
  roomId,
  currentUserId,
  memberUserIds,
  roomDisplayName,
  roomType,
  memberCount,
  onOpenSettings,
  onRoomRenamed,
  onLeave,
}) => {
  const isMobile = useIsMobile();
  const [messages, setMessages] = useState<DecryptedEvent[]>([]);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [contextMenuEventId, setContextMenuEventId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [deletedEventIds, setDeletedEventIds] = useState<Set<string>>(new Set());
  const [viewOnceMode, setViewOnceMode] = useState(false);
  const [viewedOnceIds, setViewedOnceIds] = useState<Set<string>>(new Set());
  const [hiddenOnceIds, setHiddenOnceIds] = useState<Set<string>>(new Set());
  const [expiredEventIds, setExpiredEventIds] = useState<Set<string>>(new Set());
  const [disappearingSettings, setDisappearingSettings] = useState<{
    enabled: boolean;
    timeoutSeconds: number;
  } | null>(null);
  const [showDisappearingMenu, setShowDisappearingMenu] = useState(false);

  // Inline rename state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleStartRename = useCallback(() => {
    setEditNameValue(roomDisplayName || '');
    setIsEditingName(true);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }, [roomDisplayName]);

  const handleCancelRename = useCallback(() => {
    setIsEditingName(false);
    setEditNameValue('');
  }, []);

  const handleConfirmRename = useCallback(async () => {
    const trimmed = editNameValue.trim();
    if (!trimmed || trimmed === roomDisplayName) {
      handleCancelRename();
      return;
    }
    setIsRenaming(true);
    try {
      await renameRoom(roomId, trimmed);
      onRoomRenamed?.(roomId, trimmed);
      setIsEditingName(false);
    } catch (err) {
      console.error('Failed to rename room:', err);
    } finally {
      setIsRenaming(false);
    }
  }, [editNameValue, roomDisplayName, roomId, onRoomRenamed, handleCancelRename]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirmRename();
    } else if (e.key === 'Escape') {
      handleCancelRename();
    }
  }, [handleConfirmRename, handleCancelRename]);

  const nextBatchRef = useRef<string | undefined>(undefined);
  const abortRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Tick relative timestamps every 30s so "just now" updates to "1 min ago"
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch disappearing messages settings from the server
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getRoomSettingsAPI } = await import('../api/roomsAPI');
        const resp = await getRoomSettingsAPI(roomId);
        if (!cancelled && resp.settings?.disappearingMessages) {
          setDisappearingSettings(resp.settings.disappearingMessages as { enabled: boolean; timeoutSeconds: number });
        }
      } catch { /* settings not available yet */ }
    })();
    return () => { cancelled = true; };
  }, [roomId]);

  // Expire messages client-side based on disappearing settings
  useEffect(() => {
    if (!disappearingSettings?.enabled) return;
    const checkExpired = () => {
      const now = Date.now();
      const timeoutMs = disappearingSettings.timeoutSeconds * 1000;
      const newExpired = new Set(expiredEventIds);
      let changed = false;
      for (const msg of messages) {
        const msgTime = new Date(msg.event.originServerTs).getTime();
        if (now - msgTime > timeoutMs && !newExpired.has(msg.event.eventId)) {
          newExpired.add(msg.event.eventId);
          changed = true;
        }
      }
      if (changed) setExpiredEventIds(newExpired);
    };
    checkExpired();
    const disappearTimer = setInterval(checkExpired, 5000);
    return () => clearInterval(disappearTimer);
  }, [disappearingSettings, messages, expiredEventIds]);

  // View-once auto-hide: when a view-once message from another user is displayed,
  // mark it as viewed and hide it after 5 seconds.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const msg of messages) {
      const eventId = msg.event.eventId;
      const isOwn = msg.event.senderId === currentUserId;
      const isViewOnce = msg.plaintext && (msg.plaintext as Record<string, unknown>).viewOnce === true;
      if (isViewOnce && !isOwn && !viewedOnceIds.has(eventId) && !hiddenOnceIds.has(eventId)) {
        // Mark as viewed
        setViewedOnceIds((prev) => new Set(prev).add(eventId));
        // Start 5-second timer to hide
        const timer = setTimeout(() => {
          setHiddenOnceIds((prev) => new Set(prev).add(eventId));
        }, 5000);
        timers.push(timer);
      }
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [messages, currentUserId, viewedOnceIds, hiddenOnceIds]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, optimisticMessages]);

  /**
   * Decrypt a batch of sync events. Decryption errors are captured
   * per-event rather than failing the entire batch.
   */
  const decryptEvents = useCallback(
    async (events: SyncEvent[]): Promise<DecryptedEvent[]> => {
      const results: DecryptedEvent[] = [];
      for (const event of events) {
        const decrypted = await decryptEvent(event);
        results.push(decrypted);
      }
      return results;
    },
    [],
  );

  // Long-polling sync loop
  const syncLoop = useCallback(async () => {
    abortRef.current = false;

    while (!abortRef.current) {
      try {
        const result = await syncMessages(
          nextBatchRef.current,
          10000, // 10s long-poll timeout
          50,
        );

        if (abortRef.current) break;

        // Feed sync data through the crypto machine for to-device events
        await processSyncResponse(result);

        if (result.events.length > 0) {
          // Decrypt all incoming events
          const decryptedEvents = await decryptEvents(result.events);

          if (abortRef.current) break;

          setMessages((prev) => [...prev, ...decryptedEvents]);

          // Clear optimistic messages that have been confirmed by the server
          setOptimisticMessages((prev) =>
            prev.filter((om) => om.status === 'failed'),
          );

          nextBatchRef.current = result.nextBatch;
        }

        setSyncError(null);
      } catch (err) {
        if (abortRef.current) break;
        setSyncError('Failed to sync messages');
        // Back off before retrying on error
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }, [decryptEvents]);

  useEffect(() => {
    // Reset state when room changes
    setMessages([]);
    setOptimisticMessages([]);
    nextBatchRef.current = undefined;
    abortRef.current = true;

    // Start sync loop after a tick to let abort take effect
    const timer = setTimeout(() => {
      syncLoop();
    }, 0);

    return () => {
      abortRef.current = true;
      clearTimeout(timer);
    };
  }, [roomId, syncLoop]);

  const handleSend = async (retryText?: string) => {
    const text = retryText || inputValue.trim();
    if (!text || isSending) return;

    // Capture view-once state before resetting
    const isViewOnce = viewOnceMode;

    // Create optimistic message
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: OptimisticMessage = {
      id: optimisticId,
      body: text,
      timestamp: Date.now(),
      status: 'sending',
      viewOnce: isViewOnce,
    };

    setOptimisticMessages((prev) => [...prev, optimistic]);
    if (!retryText) {
      setInputValue('');
      setViewOnceMode(false);
    }
    setIsSending(true);

    try {
      // Always encrypt — no plaintext bypass (Security Finding 1)
      const plaintext: Record<string, unknown> = {
        msgtype: 'm.text',
        body: text,
      };
      if (isViewOnce) {
        plaintext.viewOnce = true;
      }

      const encryptedContent = await encryptForRoom(
        roomId,
        'm.room.message',
        plaintext,
        memberUserIds,
      );

      await sendMessage(roomId, 'm.room.encrypted', encryptedContent);

      // Mark as sent
      setOptimisticMessages((prev) =>
        prev.map((om) =>
          om.id === optimisticId ? { ...om, status: 'sent' as const } : om,
        ),
      );
    } catch (err) {
      console.error('Failed to send message:', err);
      // Mark as failed
      setOptimisticMessages((prev) =>
        prev.map((om) =>
          om.id === optimisticId ? { ...om, status: 'failed' as const } : om,
        ),
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleRetry = (om: OptimisticMessage) => {
    // Remove the failed message and re-send
    setOptimisticMessages((prev) => prev.filter((m) => m.id !== om.id));
    handleSend(om.body);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Close context menu and disappearing menu on click anywhere
  useEffect(() => {
    const handleClick = () => {
      setContextMenuEventId(null);
      setContextMenuPos(null);
      setShowDisappearingMenu(false);
    };
    if (contextMenuEventId || showDisappearingMenu) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenuEventId, showDisappearingMenu]);

  const handleMessageContextMenu = (
    e: React.MouseEvent,
    eventId: string,
    senderId: string,
  ) => {
    if (senderId !== currentUserId) return;
    if (deletedEventIds.has(eventId)) return;
    e.preventDefault();
    setContextMenuEventId(eventId);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleDeleteMessage = async (eventId: string) => {
    setContextMenuEventId(null);
    setContextMenuPos(null);
    try {
      await deleteMessage(eventId);
      setDeletedEventIds((prev) => new Set(prev).add(eventId));
    } catch (err) {
      console.error('Failed to delete message:', err);
    }
  };

  /**
   * Render the message body for a decrypted event.
   * All content is sanitized via DOMPurify before display.
   */
  const renderMessageContent = (decrypted: DecryptedEvent): string => {
    if (decrypted.decryptionError) {
      return 'Unable to decrypt';
    }

    const content = decrypted.plaintext;
    if (!content) {
      return 'Unable to decrypt';
    }

    // Prefer the body field for text messages
    const raw =
      typeof content.body === 'string'
        ? content.body
        : typeof content.ciphertext === 'string'
          ? content.ciphertext
          : JSON.stringify(content);

    return DOMPurify.sanitize(raw);
  };

  /**
   * Render the encryption status icon for a message.
   */
  const renderEncryptionIcon = (decrypted: DecryptedEvent): React.ReactNode => {
    if (!decrypted.isEncrypted) {
      return null;
    }

    if (decrypted.decryptionError) {
      return (
        <span
          style={styles.encryptionWarning}
          title={`Decryption failed: ${decrypted.decryptionError}`}
        >
          &#9888;
        </span>
      );
    }

    return (
      <span style={styles.encryptionLock} title="Encrypted">
        &#128274;
      </span>
    );
  };

  /**
   * Render a send status indicator for outgoing optimistic messages.
   */
  const renderSendStatus = (status: MessageSendStatus): React.ReactNode => {
    switch (status) {
      case 'sending':
        return (
          <span style={styles.statusIcon} title="Sending">
            {/* Clock icon (U+1F551) */}
            &#128337;
          </span>
        );
      case 'sent':
        return (
          <span style={styles.statusIconSent} title="Sent">
            {/* Check mark */}
            &#10003;
          </span>
        );
      case 'failed':
        return (
          <span style={styles.statusIconFailed} title="Failed to send">
            {/* Cross mark */}
            &#10007;
          </span>
        );
      default:
        return null;
    }
  };

  // Derive header display name
  const headerName = roomDisplayName
    ? DOMPurify.sanitize(roomDisplayName)
    : DOMPurify.sanitize(roomId);

  return (
    <div style={{ ...styles.container, ...(isMobile ? { borderRadius: 0, border: 'none' } : {}) }}>
      {/* Room header with name, member info, encryption badge, and info button */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.headerNameRow}>
            {isEditingName ? (
              <input
                ref={renameInputRef}
                type="text"
                style={styles.renameInput}
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={handleCancelRename}
                disabled={isRenaming}
                maxLength={128}
                aria-label="Rename room"
              />
            ) : (
              <span
                style={{
                  ...styles.headerName,
                  ...(isMobile ? { maxWidth: '60vw' } : {}),
                  cursor: 'pointer',
                }}
                onClick={handleStartRename}
                title="Click to rename"
              >
                {headerName}
              </span>
            )}
            {roomType === 'direct' && !isEditingName && (
              <span style={styles.verifiedBadge} title="Verified contact">
                &#10003;
              </span>
            )}
          </div>
          <div style={styles.headerSubRow}>
            <span
              style={styles.encryptionBadge}
              title="End-to-end encryption enabled"
            >
              E2EE
            </span>
            {roomType === 'group' && memberCount != null && memberCount > 0 && (
              <span style={styles.headerMemberCount}>
                {memberCount} member{memberCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' as const }}>
          {/* Disappearing messages toggle */}
          <button
            type="button"
            style={{
              ...styles.disappearingButton,
              ...(disappearingSettings?.enabled ? styles.disappearingButtonActive : {}),
            }}
            title="Disappearing messages"
            onClick={() => setShowDisappearingMenu(!showDisappearingMenu)}
          >
            {disappearingSettings?.enabled ? 'Auto-delete ON' : 'Auto-delete'}
          </button>
          {showDisappearingMenu && (
            <div style={styles.disappearingMenu}>
              <div style={styles.disappearingMenuTitle}>Disappearing Messages</div>
              {[
                { label: 'Off', seconds: 0 },
                { label: '30 seconds', seconds: 30 },
                { label: '5 minutes', seconds: 300 },
                { label: '1 hour', seconds: 3600 },
                { label: '24 hours', seconds: 86400 },
              ].map((opt) => (
                <button
                  key={opt.seconds}
                  type="button"
                  style={{
                    ...styles.disappearingMenuItem,
                    ...(disappearingSettings?.enabled && disappearingSettings.timeoutSeconds === opt.seconds
                      ? { color: '#58a6ff' }
                      : {}),
                    ...(!disappearingSettings?.enabled && opt.seconds === 0 ? { color: '#58a6ff' } : {}),
                  }}
                  onClick={async () => {
                    try {
                      const { updateRoomSettings } = await import('../api/roomsAPI');
                      const newSettings = opt.seconds === 0
                        ? { disappearingMessages: { enabled: false, timeoutSeconds: 0 } }
                        : { disappearingMessages: { enabled: true, timeoutSeconds: opt.seconds } };
                      await updateRoomSettings(roomId, newSettings);
                      setDisappearingSettings(
                        opt.seconds === 0 ? null : { enabled: true, timeoutSeconds: opt.seconds },
                      );
                    } catch (err) {
                      console.error('Failed to update disappearing settings:', err);
                    }
                    setShowDisappearingMenu(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {onLeave && (
            <button
              type="button"
              style={styles.leaveButton}
              title="Leave conversation"
              onClick={onLeave}
            >
              Leave
            </button>
          )}
          <button
            type="button"
            style={styles.infoButton}
            title="Room info"
            onClick={() => onOpenSettings?.()}
          >
            i
          </button>
        </div>
      </div>

      {/* Sync error banner */}
      {syncError && <div style={styles.errorBanner}>{syncError}</div>}

      {/* Message list */}
      <div style={styles.messageList}>
        {messages.length === 0 && optimisticMessages.length === 0 && (
          <div style={styles.emptyState}>No messages yet</div>
        )}

        {/* Server-confirmed messages */}
        {messages.map((decrypted) => {
          const event = decrypted.event;
          const isOwn = event.senderId === currentUserId;
          const hasError = decrypted.decryptionError !== null;

          const isDeleted = deletedEventIds.has(event.eventId);
          const isExpired = expiredEventIds.has(event.eventId);
          const isViewOnce = decrypted.plaintext && (decrypted.plaintext as Record<string, unknown>).viewOnce === true;
          const isHiddenOnce = hiddenOnceIds.has(event.eventId);

          if (isViewOnce && isHiddenOnce && !isOwn) {
            return (
              <div key={event.eventId} style={{ ...styles.messageBubble, ...(isMobile ? { maxWidth: '85%' } : {}), ...styles.otherMessage, opacity: 0.5 }}>
                <div style={styles.messageBody}>
                  <span style={styles.viewOnceIcon} title="View-once message">&#128065;</span>
                  <span style={{ fontStyle: 'italic', color: '#8b949e' }}>Viewed</span>
                </div>
              </div>
            );
          }

          return (
            <div
              key={event.eventId}
              style={{
                ...styles.messageBubble,
                ...(isMobile ? { maxWidth: '85%' } : {}),
                ...(isOwn ? styles.ownMessage : styles.otherMessage),
                ...(hasError ? styles.errorMessage : {}),
              }}
              onContextMenu={(e) =>
                handleMessageContextMenu(e, event.eventId, event.senderId)
              }
            >
              {!isOwn && (
                <div style={styles.senderName}>
                  {DOMPurify.sanitize(formatDisplayName(event.senderId))}
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
                    {renderEncryptionIcon(decrypted)}
                    <span
                      style={hasError ? styles.errorText : undefined}
                    >
                      {renderMessageContent(decrypted)}
                    </span>
                  </>
                )}
              </div>
              <div style={styles.timestamp}>
                {formatRelativeTime(event.originServerTs)}
              </div>
            </div>
          );
        })}

        {/* Optimistic (outgoing) messages */}
        {optimisticMessages.map((om) => (
          <div
            key={om.id}
            style={{
              ...styles.messageBubble,
              ...(isMobile ? { maxWidth: '85%' } : {}),
              ...styles.ownMessage,
              ...(om.status === 'sending' ? styles.optimisticSending : {}),
              ...(om.status === 'failed' ? styles.optimisticFailed : {}),
            }}
          >
            <div style={styles.messageBody}>
              <span>{DOMPurify.sanitize(om.body)}</span>
            </div>
            <div style={styles.timestampRow}>
              <span style={styles.timestamp}>
                {formatRelativeTime(new Date(om.timestamp))}
              </span>
              {renderSendStatus(om.status)}
              {om.status === 'failed' && (
                <button
                  type="button"
                  style={styles.retryInlineButton}
                  onClick={() => handleRetry(om)}
                  title="Retry sending"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={{ ...styles.inputArea, ...(isMobile ? { padding: '8px 10px', gap: 6 } : {}) }}>
        <button
          type="button"
          style={{
            ...styles.viewOnceToggle,
            ...(viewOnceMode ? styles.viewOnceToggleActive : {}),
          }}
          onClick={() => setViewOnceMode((v) => !v)}
          title={viewOnceMode ? 'View-once enabled — recipient can only view this once' : 'Enable view-once mode'}
          aria-label="Toggle view-once mode"
        >
          &#128065;
        </button>
        <input
          type="text"
          style={{ ...styles.input, ...(isMobile ? { padding: '10px 12px', fontSize: 16 } : {}) }}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={viewOnceMode ? 'View-once message...' : 'Type a message...'}
          disabled={isSending}
          aria-label="Message input"
        />
        <button
          style={{
            ...styles.sendButton,
            ...(isMobile ? { padding: '10px 12px', minWidth: 44, minHeight: 44 } : {}),
            ...((isSending || !inputValue.trim()) ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
          }}
          onClick={() => handleSend()}
          disabled={isSending || !inputValue.trim()}
          aria-label="Send message"
        >
          {isMobile ? (
            isSending ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="14 14" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )
          ) : (
            isSending ? 'Sending...' : 'Send'
          )}
        </button>
      </div>

      {/* Context menu for deleting own messages */}
      {contextMenuEventId && contextMenuPos && (
        <div
          style={{
            ...styles.contextMenu,
            top: contextMenuPos.y,
            left: contextMenuPos.x,
          }}
        >
          <button
            type="button"
            style={styles.contextMenuItem}
            onClick={() => handleDeleteMessage(contextMenuEventId)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

// ── Inline styles ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    fontFamily: FONT_BODY,
    border: '1px solid #30363d',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#0d1117',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '10px 14px',
    borderBottom: '1px solid #30363d',
    backgroundColor: '#161b22',
  },
  headerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    minWidth: 0,
  },
  headerNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  headerName: {
    fontSize: 15,
    fontWeight: 600,
    color: '#e6edf3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  verifiedBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    borderRadius: '50%',
    backgroundColor: 'rgba(35, 134, 54, 0.2)',
    color: '#3fb950',
    fontSize: 10,
    fontWeight: 700,
    flexShrink: 0,
  },
  headerSubRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerMemberCount: {
    fontSize: 12,
    color: '#8b949e',
  },
  infoButton: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: '1px solid #30363d',
    backgroundColor: 'transparent',
    color: '#8b949e',
    fontSize: 14,
    fontWeight: 600,
    fontStyle: 'italic',
    fontFamily: 'inherit',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'border-color 0.15s, color 0.15s',
  },
  renameInput: {
    fontSize: 15,
    fontWeight: 600,
    color: '#e6edf3',
    backgroundColor: '#0d1117',
    border: '1px solid #58a6ff',
    borderRadius: 4,
    padding: '2px 6px',
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
    maxWidth: 240,
  },
  encryptionBadge: {
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: 4,
    backgroundColor: 'rgba(35, 134, 54, 0.15)',
    color: '#3fb950',
  },
  roomLabel: {
    fontSize: 13,
    color: '#c9d1d9',
  },
  errorBanner: {
    padding: '6px 12px',
    backgroundColor: '#3d1f28',
    color: '#f85149',
    fontSize: 13,
  },
  messageList: {
    flex: 1,
    overflowY: 'auto',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  emptyState: {
    textAlign: 'center',
    color: '#8b949e',
    marginTop: 40,
    fontSize: 14,
  },
  messageBubble: {
    maxWidth: '70%',
    padding: '8px 12px',
    borderRadius: 12,
    fontSize: 14,
    lineHeight: 1.4,
    wordBreak: 'break-word',
  },
  ownMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#58a6ff',
    color: '#ffffff',
  },
  otherMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#21262d',
    color: '#c9d1d9',
  },
  errorMessage: {
    opacity: 0.7,
    borderLeft: '3px solid #f85149',
  },
  optimisticSending: {
    opacity: 0.7,
  },
  optimisticFailed: {
    opacity: 0.8,
    backgroundColor: '#4a3040',
    borderRight: '3px solid #f85149',
  },
  senderName: {
    fontSize: 11,
    fontWeight: 600,
    marginBottom: 2,
    color: '#c9d1d9',
  },
  messageBody: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 4,
  },
  encryptionLock: {
    fontSize: 12,
    flexShrink: 0,
    marginTop: 1,
  },
  encryptionWarning: {
    fontSize: 14,
    color: '#f85149',
    flexShrink: 0,
    marginTop: -1,
  },
  errorText: {
    fontStyle: 'italic',
    opacity: 0.8,
  },
  timestampRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 4,
  },
  timestamp: {
    fontSize: 10,
    marginTop: 4,
    opacity: 0.7,
    textAlign: 'right',
  },
  statusIcon: {
    fontSize: 10,
    opacity: 0.6,
  },
  statusIconSent: {
    fontSize: 11,
    color: '#ffffff',
    opacity: 0.8,
  },
  statusIconFailed: {
    fontSize: 12,
    color: '#f85149',
  },
  retryInlineButton: {
    padding: '1px 6px',
    fontSize: 10,
    fontWeight: 600,
    backgroundColor: 'rgba(248, 81, 73, 0.2)',
    color: '#f85149',
    border: '1px solid rgba(248, 81, 73, 0.4)',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginLeft: 2,
  },
  inputArea: {
    display: 'flex',
    gap: 8,
    padding: 12,
    borderTop: '1px solid #30363d',
    backgroundColor: '#161b22',
  },
  input: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 20,
    border: '1px solid #30363d',
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
    fontSize: 14,
    fontFamily: 'inherit',
    transition: 'border-color 0.15s',
  },
  sendButton: {
    padding: '8px 16px',
    borderRadius: 20,
    border: 'none',
    backgroundColor: '#58a6ff',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background-color 0.15s',
  },
  deletedText: {
    fontStyle: 'italic',
    color: '#8b949e',
    opacity: 0.7,
  },
  contextMenu: {
    position: 'fixed' as const,
    zIndex: 9999,
    backgroundColor: '#21262d',
    border: '1px solid #30363d',
    borderRadius: 6,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    padding: 4,
    minWidth: 120,
  },
  contextMenuItem: {
    display: 'block',
    width: '100%',
    padding: '6px 12px',
    fontSize: 13,
    color: '#f85149',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontFamily: 'inherit',
  },
  expiredText: {
    fontStyle: 'italic',
    color: '#8b949e',
    opacity: 0.6,
  },
  leaveButton: {
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    backgroundColor: 'rgba(248, 81, 73, 0.1)',
    color: '#f85149',
    border: '1px solid rgba(248, 81, 73, 0.3)',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  disappearingButton: {
    padding: '4px 8px',
    fontSize: 10,
    fontWeight: 600,
    backgroundColor: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap' as const,
  },
  disappearingButtonActive: {
    backgroundColor: 'rgba(210, 153, 34, 0.15)',
    color: '#d29922',
    borderColor: '#d29922',
  },
  disappearingMenu: {
    position: 'absolute' as const,
    top: '100%',
    right: 0,
    marginTop: 4,
    backgroundColor: '#21262d',
    border: '1px solid #30363d',
    borderRadius: 8,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    padding: 6,
    zIndex: 100,
    minWidth: 160,
  },
  disappearingMenuTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: '#8b949e',
    padding: '4px 8px 6px',
    borderBottom: '1px solid #30363d',
    marginBottom: 4,
  },
  disappearingMenuItem: {
    display: 'block',
    width: '100%',
    padding: '6px 8px',
    fontSize: 12,
    color: '#c9d1d9',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontFamily: 'inherit',
  },
};

export default ChatWindow;
