import React, { useState, useEffect, useRef, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
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
 * Deterministic avatar color from a string — same hash and palette as RoomList
 * so sender colors are consistent across the app.
 */
const AVATAR_COLORS = ['#da3633', '#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f78166'];

function getAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Format a date as a human-friendly relative timestamp.
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

/**
 * Format a date separator label ("Today", "Yesterday", "March 15").
 */
function formatDateSeparator(date: Date | string): string {
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
function isDifferentDay(a: Date | string, b: Date | string): boolean {
  const da = typeof a === 'string' ? new Date(a) : a;
  const db = typeof b === 'string' ? new Date(b) : b;
  return da.getFullYear() !== db.getFullYear() ||
    da.getMonth() !== db.getMonth() ||
    da.getDate() !== db.getDate();
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
  memberUserIds: string[];
  roomDisplayName?: string;
  roomType?: 'direct' | 'group';
  memberCount?: number;
  onOpenSettings?: () => void;
  onRoomRenamed?: (roomId: string, newName: string) => void;
  onLeave?: () => void;
  // E2EE is always enabled — no plaintext bypass allowed (Security Finding 1)
}

/** Time gap threshold for grouping consecutive messages from the same sender (5 min) */
const GROUP_GAP_MS = 5 * 60 * 1000;
/** Time gap threshold for showing an inline timestamp between groups (10 min) */
const TIMESTAMP_GAP_MS = 10 * 60 * 1000;

/**
 * Chat UI component with Megolm group encryption.
 *
 * Features:
 * - Message grouping: consecutive messages from the same sender are grouped
 * - Smart timestamps: only shown between groups or on >10 min gaps
 * - Date separators: "Today", "Yesterday", "March 15"
 * - Typing indicator placeholder slot
 * - Smooth scroll with "New messages" pill when scrolled up
 * - Auto-growing textarea with Shift+Enter for newlines
 * - Consistent avatar colors matching RoomList
 * - Empty room welcome messages
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

  // "New messages" pill — shown when user has scrolled up and new messages arrive
  const [showNewMessagesPill, setShowNewMessagesPill] = useState(false);
  const isNearBottomRef = useRef(true);

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
      void handleConfirmRename();
    } else if (e.key === 'Escape') {
      handleCancelRename();
    }
  }, [handleConfirmRename, handleCancelRename]);

  const nextBatchRef = useRef<string | undefined>(undefined);
  const abortRef = useRef(false);
  const syncGenRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Tick relative timestamps every 30s
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  // Inject typing indicator animation keyframes
  useEffect(() => {
    const styleId = 'frame-typing-keyframes';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes frame-typing-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
        textarea::placeholder { color: #484f58; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Fetch disappearing messages settings
  useEffect(() => {
    let cancelled = false;
    void (async () => {
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

  // Expire messages client-side
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

  // View-once auto-hide
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const msg of messages) {
      const eventId = msg.event.eventId;
      const isOwn = msg.event.senderId === currentUserId;
      const isViewOnce = msg.plaintext && msg.plaintext.viewOnce === true;
      if (isViewOnce && !isOwn && !viewedOnceIds.has(eventId) && !hiddenOnceIds.has(eventId)) {
        setViewedOnceIds((prev) => new Set(prev).add(eventId));
        const timer = setTimeout(() => {
          setHiddenOnceIds((prev) => new Set(prev).add(eventId));
          setMessages((prev) =>
            prev.map((m) =>
              m.event.eventId === eventId
                ? { ...m, plaintext: null, decryptionError: 'View-once message already viewed' }
                : m,
            ),
          );
        }, 5000);
        timers.push(timer);
      }
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [messages, currentUserId, viewedOnceIds, hiddenOnceIds]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    const threshold = 80;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) {
      setShowNewMessagesPill(false);
    }
  }, []);

  // Smooth-scroll to bottom when new messages arrive (only if near bottom)
  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (messages.length > 0) {
      setShowNewMessagesPill(true);
    }
  }, [messages, optimisticMessages]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowNewMessagesPill(false);
  }, []);

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

  // Long-polling sync loop — uses a generation counter so that stale
  // loops from a previous room reliably stop even if the boolean flag
  // is overwritten by the new loop before the old fetch returns.
  const syncLoop = useCallback(async (gen: number) => {
    while (syncGenRef.current === gen) {
      try {
        const result = await syncMessages(
          nextBatchRef.current,
          10000,
          50,
        );

        if (syncGenRef.current !== gen) break;

        await processSyncResponse(result);

        // Always update nextBatch so the next poll uses the latest
        // sequence cursor, even when no room events were returned
        // (e.g. timeout expiry or to-device-only responses).
        nextBatchRef.current = result.nextBatch;

        if (result.events.length > 0) {
          // Filter to only events belonging to the current room —
          // the server returns events across all rooms the user is in.
          const roomEvents = result.events.filter((e) => e.roomId === roomId);
          const decryptedEvents = roomEvents.length > 0
            ? await decryptEvents(roomEvents)
            : [];

          if (syncGenRef.current !== gen) break;

          if (decryptedEvents.length > 0) {
            setMessages((prev) => [...prev, ...decryptedEvents]);
          }
          setOptimisticMessages((prev) =>
            prev.filter((om) => om.status === 'failed'),
          );
        }

        setSyncError(null);
      } catch (err) {
        if (syncGenRef.current !== gen) break;
        setSyncError('Failed to sync messages');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }, [decryptEvents, roomId]);

  useEffect(() => {
    setMessages([]);
    setOptimisticMessages([]);
    nextBatchRef.current = undefined;

    // Increment generation to invalidate any in-flight sync loop
    const gen = ++syncGenRef.current;

    const timer = setTimeout(() => {
      void syncLoop(gen);
    }, 0);

    return () => {
      // Bump generation again so the loop exits on next check
      syncGenRef.current++;
      clearTimeout(timer);
    };
  }, [roomId, syncLoop]);

  const handleSend = async (retryText?: string) => {
    const text = retryText || inputValue.trim();
    if (!text || isSending) return;

    const isViewOnce = viewOnceMode;

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
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
    setIsSending(true);

    try {
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

      setOptimisticMessages((prev) =>
        prev.map((om) =>
          om.id === optimisticId ? { ...om, status: 'sent' as const } : om,
        ),
      );
    } catch (err) {
      console.error('Failed to send message:', err);
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
    setOptimisticMessages((prev) => prev.filter((m) => m.id !== om.id));
    void handleSend(om.body);
  };

  // Shift+Enter inserts newline; Enter alone sends
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // Auto-grow textarea up to 5 lines max
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    const lineHeight = 20;
    const maxHeight = lineHeight * 5 + 16;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
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

  const renderMessageContent = (decrypted: DecryptedEvent): string => {
    if (decrypted.decryptionError) {
      return 'Unable to decrypt';
    }

    const content = decrypted.plaintext;
    if (!content) {
      return 'Unable to decrypt';
    }

    const raw =
      typeof content.body === 'string'
        ? content.body
        : typeof content.ciphertext === 'string'
          ? content.ciphertext
          : JSON.stringify(content);

    return DOMPurify.sanitize(raw, PURIFY_CONFIG);
  };

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

  const renderSendStatus = (status: MessageSendStatus): React.ReactNode => {
    switch (status) {
      case 'sending':
        return (
          <span style={styles.statusIcon} title="Sending">
            &#128337;
          </span>
        );
      case 'sent':
        return (
          <span style={styles.statusIconSent} title="Sent">
            &#10003;
          </span>
        );
      case 'failed':
        return (
          <span style={styles.statusIconFailed} title="Failed to send">
            &#10007;
          </span>
        );
      default:
        return null;
    }
  };

  const headerName = roomDisplayName
    ? DOMPurify.sanitize(roomDisplayName, PURIFY_CONFIG)
    : DOMPurify.sanitize(roomId, PURIFY_CONFIG);

  // ── Build grouped message list with date separators and smart timestamps ──

  const renderMessages = () => {
    const elements: React.ReactNode[] = [];
    let lastSenderId: string | null = null;
    let lastTimestamp: Date | null = null;
    let lastDate: Date | null = null;

    for (const [i, decrypted] of messages.entries()) {
      const event = decrypted.event;
      const isOwn = event.senderId === currentUserId;
      const hasError = decrypted.decryptionError !== null;
      const msgDate = new Date(event.originServerTs);

      const isDeleted = deletedEventIds.has(event.eventId);
      const isExpired = expiredEventIds.has(event.eventId);
      const isViewOnce = decrypted.plaintext && decrypted.plaintext.viewOnce === true;
      const isHiddenOnce = hiddenOnceIds.has(event.eventId);

      // Date separator: show when calendar day changes
      if (!lastDate || isDifferentDay(lastDate, msgDate)) {
        elements.push(
          <div key={`date-${event.eventId}`} style={styles.dateSeparator}>
            <div style={styles.dateSeparatorLine} />
            <span style={styles.dateSeparatorText}>{formatDateSeparator(msgDate)}</span>
            <div style={styles.dateSeparatorLine} />
          </div>
        );
      }

      // Determine if this message starts a new group
      const timeSinceLastMs = lastTimestamp ? msgDate.getTime() - lastTimestamp.getTime() : Infinity;
      const isSameSenderAsPrev = lastSenderId === event.senderId;
      const isNewGroup = !isSameSenderAsPrev || timeSinceLastMs > GROUP_GAP_MS;

      // Show a time gap divider between groups if >10 min (on the same day)
      if (lastTimestamp && timeSinceLastMs > TIMESTAMP_GAP_MS && lastDate && !isDifferentDay(lastDate, msgDate)) {
        elements.push(
          <div key={`gap-${event.eventId}`} style={styles.timeGap}>
            <span style={styles.timeGapText}>{formatRelativeTime(msgDate)}</span>
          </div>
        );
      }

      // Handle view-once hidden messages
      if (isViewOnce && isHiddenOnce && !isOwn) {
        elements.push(
          <div key={event.eventId} style={{ ...styles.messageBubble, ...(isMobile ? { maxWidth: '85%' } : {}), ...styles.otherMessage, opacity: 0.5, alignSelf: 'flex-start' as const }}>
            <div style={styles.messageBody}>
              <span style={styles.viewOnceIcon} title="View-once message">&#128065;</span>
              <span style={{ fontStyle: 'italic', color: '#8b949e' }}>Viewed</span>
            </div>
          </div>
        );
        lastSenderId = event.senderId;
        lastTimestamp = msgDate;
        lastDate = msgDate;
        continue;
      }

      // Determine bubble shape based on grouping
      const isFirstInGroup = isNewGroup;
      const nextMsg = messages[i + 1];
      const isLastInGroup = !nextMsg ||
        nextMsg.event.senderId !== event.senderId ||
        (new Date(nextMsg.event.originServerTs).getTime() - msgDate.getTime()) > GROUP_GAP_MS;

      const bubbleRadius = isOwn
        ? {
            borderTopLeftRadius: 12,
            borderTopRightRadius: isFirstInGroup ? 12 : 4,
            borderBottomLeftRadius: 12,
            borderBottomRightRadius: isLastInGroup ? 12 : 4,
          }
        : {
            borderTopLeftRadius: isFirstInGroup ? 12 : 4,
            borderTopRightRadius: 12,
            borderBottomLeftRadius: isLastInGroup ? 12 : 4,
            borderBottomRightRadius: 12,
          };

      elements.push(
        <div
          key={event.eventId}
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            alignSelf: isOwn ? 'flex-end' : 'flex-start',
            maxWidth: isMobile ? '85%' : '70%',
            marginTop: isFirstInGroup ? 8 : 2,
          }}
        >
          {/* Avatar — only show on first message in a group from other users */}
          {!isOwn && (
            <div style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              backgroundColor: isFirstInGroup ? getAvatarColor(event.senderId) : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              color: '#fff',
              flexShrink: 0,
              visibility: isFirstInGroup ? ('visible' as const) : ('hidden' as const),
            }}>
              {isFirstInGroup ? formatDisplayName(event.senderId).charAt(0).toUpperCase() : ''}
            </div>
          )}
          <div
            style={{
              ...styles.messageBubble,
              ...(isOwn ? styles.ownMessage : styles.otherMessage),
              ...(hasError ? styles.errorMessage : {}),
              ...bubbleRadius,
              marginTop: 0,
            }}
            onContextMenu={(e) =>
              handleMessageContextMenu(e, event.eventId, event.senderId)
            }
          >
            {/* Sender name — only on first message of a group from others */}
            {!isOwn && isFirstInGroup && (
              <div style={{ ...styles.senderName, color: getAvatarColor(event.senderId) }}>
                {DOMPurify.sanitize(formatDisplayName(event.senderId), PURIFY_CONFIG)}
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
                  <span style={hasError ? styles.errorText : undefined}>
                    {renderMessageContent(decrypted)}
                  </span>
                </>
              )}
            </div>
            {/* Timestamp — only on last message of a group */}
            {isLastInGroup && (
              <div style={styles.timestamp}>
                {formatRelativeTime(event.originServerTs)}
              </div>
            )}
          </div>
        </div>
      );

      lastSenderId = event.senderId;
      lastTimestamp = msgDate;
      lastDate = msgDate;
    }

    return elements;
  };

  // ── Welcome message for empty rooms ──

  const renderWelcome = () => {
    if (messages.length > 0 || optimisticMessages.length > 0) return null;

    const isGroup = roomType === 'group';

    return (
      <div style={styles.welcomeContainer}>
        <div style={styles.welcomeIconWrap}>
          {isGroup ? (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="18" cy="16" r="6" stroke="#58a6ff" strokeWidth="1.5" fill="none" />
              <circle cx="30" cy="16" r="6" stroke="#58a6ff" strokeWidth="1.5" fill="none" />
              <path d="M6 38c0-6.627 5.373-12 12-12h12c6.627 0 12 5.373 12 12" stroke="#58a6ff" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="6" y="14" width="36" height="24" rx="6" stroke="#3fb950" strokeWidth="1.5" fill="none" />
              <path d="M6 20l18 10 18-10" stroke="#3fb950" strokeWidth="1.5" fill="none" />
            </svg>
          )}
        </div>
        <div style={styles.welcomeTitle}>
          {isGroup
            ? `Welcome to ${headerName}`
            : `This is the beginning of your encrypted conversation with ${headerName}`}
        </div>
        <div style={styles.welcomeSubtitle}>
          {isGroup
            ? 'Messages in this group are end-to-end encrypted.'
            : 'Messages are secured with end-to-end encryption.'}
        </div>
        <div style={styles.welcomeE2eeBadge}>
          <span style={{ fontSize: 12 }}>&#128274;</span> E2EE
        </div>
      </div>
    );
  };

  return (
    <div style={{ ...styles.container, ...(isMobile ? { borderRadius: 0, border: 'none' } : {}) }}>
      {/* Room header */}
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
                  onClick={() => {
                    void (async () => {
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
                    })();
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
      <div
        ref={messageListRef}
        style={styles.messageList}
        onScroll={handleScroll}
      >
        {renderWelcome()}

        {renderMessages()}

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
              alignSelf: 'flex-end' as const,
            }}
          >
            <div style={styles.messageBody}>
              <span>{DOMPurify.sanitize(om.body, PURIFY_CONFIG)}</span>
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

        {/* Typing indicator placeholder — hidden by default, set display:'flex' when active */}
        <div style={styles.typingIndicator} aria-label="Typing indicator">
          <div style={styles.typingDot} />
          <div style={{ ...styles.typingDot, animationDelay: '0.2s' }} />
          <div style={{ ...styles.typingDot, animationDelay: '0.4s' }} />
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* "New messages" pill when user has scrolled up */}
      {showNewMessagesPill && (
        <button
          type="button"
          style={styles.newMessagesPill}
          onClick={scrollToBottom}
        >
          New messages
        </button>
      )}

      {/* Input area — textarea with auto-grow, Shift+Enter for newlines */}
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
        <textarea
          ref={textareaRef}
          style={{
            ...styles.textarea,
            ...(isMobile ? { padding: '10px 12px', fontSize: 16 } : {}),
          }}
          value={inputValue}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          placeholder={viewOnceMode ? 'View-once message...' : 'Type a message...'}
          disabled={isSending}
          aria-label="Message input"
          rows={1}
        />
        <button
          style={{
            ...styles.sendButton,
            ...(isMobile ? { padding: '10px 12px', minWidth: 44, minHeight: 44 } : {}),
            ...((isSending || !inputValue.trim()) ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
          }}
          onClick={() => void handleSend()}
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
            onClick={() => void handleDeleteMessage(contextMenuEventId)}
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
    position: 'relative',
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
    gap: 2,
  },

  // ── Date separators ──
  dateSeparator: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    margin: '16px 0 8px',
  },
  dateSeparatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#21262d',
  },
  dateSeparatorText: {
    fontSize: 11,
    fontWeight: 600,
    color: '#484f58',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    flexShrink: 0,
  },

  // ── Time gap between groups ──
  timeGap: {
    display: 'flex',
    justifyContent: 'center',
    margin: '8px 0 4px',
  },
  timeGapText: {
    fontSize: 10,
    color: '#484f58',
    backgroundColor: '#161b22',
    padding: '2px 10px',
    borderRadius: 10,
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
    backgroundColor: '#58a6ff',
    color: '#ffffff',
  },
  otherMessage: {
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
    alignItems: 'flex-end',
  },
  textarea: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 20,
    border: '1px solid #30363d',
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
    fontSize: 14,
    fontFamily: 'inherit',
    transition: 'border-color 0.15s',
    resize: 'none' as const,
    lineHeight: '20px',
    minHeight: 36,
    maxHeight: 116,
    overflow: 'auto',
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
    alignSelf: 'flex-end',
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

  // ── View-once ──
  viewOnceToggle: {
    padding: '6px 8px',
    fontSize: 16,
    backgroundColor: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 20,
    cursor: 'pointer',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'border-color 0.15s, color 0.15s, background-color 0.15s',
    alignSelf: 'flex-end',
  },
  viewOnceToggleActive: {
    backgroundColor: 'rgba(210, 153, 34, 0.15)',
    color: '#d29922',
    borderColor: '#d29922',
  },
  viewOnceIcon: {
    fontSize: 12,
    flexShrink: 0,
    marginTop: 1,
    opacity: 0.7,
  },

  // ── "New messages" pill ──
  newMessagesPill: {
    position: 'absolute' as const,
    bottom: 80,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '6px 16px',
    fontSize: 12,
    fontWeight: 600,
    color: '#ffffff',
    backgroundColor: '#58a6ff',
    border: 'none',
    borderRadius: 20,
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    zIndex: 10,
    transition: 'opacity 0.2s',
  },

  // ── Typing indicator (hidden by default — set display:'flex' when active) ──
  typingIndicator: {
    display: 'none',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
    marginTop: 4,
    alignSelf: 'flex-start',
    minHeight: 20,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: '#484f58',
    animation: 'frame-typing-bounce 1.4s infinite ease-in-out',
  },

  // ── Welcome / empty room ──
  welcomeContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 24px',
    textAlign: 'center',
    flex: 1,
  },
  welcomeIconWrap: {
    marginBottom: 12,
    opacity: 0.7,
  },
  welcomeTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#e6edf3',
    marginBottom: 8,
    maxWidth: 320,
    lineHeight: 1.4,
  },
  welcomeSubtitle: {
    fontSize: 13,
    color: '#8b949e',
    marginBottom: 12,
  },
  welcomeE2eeBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    borderRadius: 12,
    backgroundColor: 'rgba(35, 134, 54, 0.1)',
    color: '#3fb950',
    fontSize: 11,
    fontWeight: 600,
  },
};

export default ChatWindow;
