import React, { useState, useEffect, useRef, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
import { sendMessage, deleteMessage, syncMessages, SyncEvent, reactToMessage, markAsRead, ReactionData } from '../api/messagesAPI';
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
import { SkeletonMessageBubble, SyncIndicator } from './Skeleton';

// ── Reaction Picker ──

const QUICK_REACTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F44F}'];

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
  showToast?: (type: 'success' | 'error' | 'info' | 'warning', message: string, options?: { persistent?: boolean; dedupeKey?: string; duration?: number }) => void;
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
  showToast,
}) => {
  const isMobile = useIsMobile();
  const [messages, setMessages] = useState<DecryptedEvent[]>([]);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  // Room switch skeleton: show placeholder bubbles briefly when switching rooms
  const [showRoomSkeleton, setShowRoomSkeleton] = useState(true);
  // Sync activity indicator: true while actively fetching
  const [isSyncing, setIsSyncing] = useState(false);
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

  // Reaction picker state
  const [reactionPickerEventId, setReactionPickerEventId] = useState<string | null>(null);
  const [reactionPickerPos, setReactionPickerPos] = useState<{ x: number; y: number } | null>(null);
  // Local reactions cache (overrides sync data after user reacts)
  const [localReactions, setLocalReactions] = useState<Record<string, Record<string, ReactionData>>>({});
  // Read receipts: track which event IDs have been marked as read
  const [readEventIds, setReadEventIds] = useState<Set<string>>(new Set());
  // Read receipt status per event: list of users who have read it
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const [readByUsers, setReadByUsers] = useState<Record<string, string[]>>({});
  /* eslint-enable @typescript-eslint/no-unused-vars */

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
  const syncGenRef = useRef(0);
  const syncBackoffRef = useRef(1000); // Exponential backoff for sync errors (ms)
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Tick relative timestamps every 30s
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  // Track newly sent message IDs for slide-up animation
  const [recentlySentIds, setRecentlySentIds] = useState<Set<string>>(new Set());
  // Track newly arrived message IDs for pop-in animation
  const [recentlyArrivedIds, setRecentlyArrivedIds] = useState<Set<string>>(new Set());
  // Track encryption lock pulse
  const [recentlyEncryptedIds, setRecentlyEncryptedIds] = useState<Set<string>>(new Set());
  // Track textarea focus for glow
  const [isTextareaFocused, setIsTextareaFocused] = useState(false);
  // Track send button animation
  const [sendButtonAnimating, setSendButtonAnimating] = useState(false);
  // Emoji picker state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // Mobile "more" menu state (for auto-delete / leave)
  const [showMobileMoreMenu, setShowMobileMoreMenu] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const CHAT_EMOJIS = [
    '\u{1F600}', '\u{1F602}', '\u{1F605}', '\u{1F609}', '\u{1F60D}', '\u{1F618}',
    '\u{1F970}', '\u{1F914}', '\u{1F923}', '\u{1F62D}', '\u{1F621}', '\u{1F631}',
    '\u{1F44D}', '\u{1F44E}', '\u{1F44B}', '\u{1F64F}', '\u{1F525}', '\u{2764}\u{FE0F}',
    '\u{1F389}', '\u{1F44F}', '\u{1F4AF}', '\u{1F440}', '\u{2705}', '\u{274C}',
  ];

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const insertEmojiAtCursor = (emoji: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart ?? inputValue.length;
      const end = ta.selectionEnd ?? inputValue.length;
      const newVal = inputValue.slice(0, start) + emoji + inputValue.slice(end);
      setInputValue(newVal);
      // Restore cursor position after React re-render
      setTimeout(() => {
        ta.selectionStart = ta.selectionEnd = start + emoji.length;
        ta.focus();
      }, 0);
    } else {
      setInputValue((v) => v + emoji);
    }
    setShowEmojiPicker(false);
  };

  // Inject animation keyframes
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
        @keyframes frame-msg-slide-up {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes frame-msg-pop-in {
          0% { opacity: 0; transform: scale(0.95); }
          60% { opacity: 1; transform: scale(1.01); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes frame-textarea-glow {
          0%, 100% { box-shadow: 0 0 4px rgba(88, 166, 255, 0.3), 0 0 8px rgba(88, 166, 255, 0.1); }
          50% { box-shadow: 0 0 8px rgba(88, 166, 255, 0.5), 0 0 16px rgba(88, 166, 255, 0.15); }
        }
        @keyframes frame-send-launch {
          0% { transform: scale(1); }
          30% { transform: scale(0.88); }
          60% { transform: scale(1.08); }
          100% { transform: scale(1); }
        }
        @keyframes frame-lock-pulse {
          0% { transform: scale(1); opacity: 1; }
          25% { transform: scale(1.4); opacity: 0.6; color: #3fb950; }
          50% { transform: scale(0.9); opacity: 1; }
          75% { transform: scale(1.15); opacity: 0.8; color: #3fb950; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes frame-welcome-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes frame-context-menu-in {
          0% { opacity: 0; transform: scale(0.92); }
          100% { opacity: 1; transform: scale(1); }
        }
        .frame-context-menu-item:hover {
          background-color: rgba(248, 81, 73, 0.15) !important;
        }
        /* Show reaction button on message row hover */
        div:hover > button[aria-label="Add reaction"] {
          opacity: 1 !important;
        }
        button[aria-label="Add reaction"]:hover {
          border-color: #58a6ff !important;
          color: #58a6ff !important;
        }
        /* Reaction picker emoji hover */
        .frame-reaction-emoji:hover {
          background-color: rgba(88, 166, 255, 0.15) !important;
          transform: scale(1.2) !important;
        }
        /* Reaction badge hover */
        .frame-reaction-badge:hover {
          border-color: #58a6ff !important;
        }
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

  // View-once auto-hide + server-side deletion
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
          // Remove content from React state — not just CSS hidden
          setMessages((prev) =>
            prev.map((m) =>
              m.event.eventId === eventId
                ? { ...m, plaintext: null, decryptionError: 'View-once message already viewed' }
                : m,
            ),
          );
          // Delete from server so content is purged from the database
          deleteMessage(eventId).catch((err) =>
            console.error('[ViewOnce] Failed to delete from server:', err),
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
        setIsSyncing(true);
        const result = await syncMessages(
          nextBatchRef.current,
          10000,
          50,
        );
        setIsSyncing(false);

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
            // Mark new messages for pop-in + encryption pulse animation
            const newIds = decryptedEvents.map((e) => e.event.eventId);
            setRecentlyArrivedIds((prev) => {
              const next = new Set(prev);
              newIds.forEach((id) => next.add(id));
              return next;
            });
            setRecentlyEncryptedIds((prev) => {
              const next = new Set(prev);
              decryptedEvents
                .filter((e) => e.isEncrypted && !e.decryptionError)
                .forEach((e) => next.add(e.event.eventId));
              return next;
            });
            // Clear animations after they play
            setTimeout(() => {
              setRecentlyArrivedIds((prev) => {
                const next = new Set(prev);
                newIds.forEach((id) => next.delete(id));
                return next;
              });
            }, 400);
            setTimeout(() => {
              setRecentlyEncryptedIds((prev) => {
                const next = new Set(prev);
                newIds.forEach((id) => next.delete(id));
                return next;
              });
            }, 800);
          }
          setOptimisticMessages((prev) =>
            prev.filter((om) => om.status === 'failed'),
          );
        }

        setSyncError(null);
        syncBackoffRef.current = 1000; // Reset backoff on success
      } catch (err) {
        setIsSyncing(false);
        if (syncGenRef.current !== gen) break;
        setSyncError('Failed to sync messages');
        // Exponential backoff: 1s → 2s → 4s → 8s → … capped at 30s
        const delay = syncBackoffRef.current;
        syncBackoffRef.current = Math.min(delay * 2, 30000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }, [decryptEvents, roomId]);

  // Show skeleton briefly on room switch, then clear once messages arrive or after 200ms
  useEffect(() => {
    setShowRoomSkeleton(true);
    const timer = setTimeout(() => setShowRoomSkeleton(false), 200);
    return () => clearTimeout(timer);
  }, [roomId]);

  useEffect(() => {
    // If real messages have arrived, clear skeleton immediately
    if (messages.length > 0 && showRoomSkeleton) {
      setShowRoomSkeleton(false);
    }
  }, [messages.length, showRoomSkeleton]);

  useEffect(() => {
    setMessages([]);
    setOptimisticMessages([]);
    nextBatchRef.current = undefined;
    syncBackoffRef.current = 1000;

    // Increment generation to invalidate any in-flight sync loop
    const gen = ++syncGenRef.current;

    const timer = setTimeout(() => {
      void syncLoop(gen);
    }, 0);

    // When the tab regains visibility (e.g. after sleeping laptop,
    // network loss, or user switching back), reset backoff and restart
    // the sync loop so messages catch up immediately.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && syncGenRef.current === gen) {
        syncBackoffRef.current = 1000;
        // Restart the loop: bump generation and start a fresh loop.
        const freshGen = ++syncGenRef.current;
        void syncLoop(freshGen);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Also handle online/offline transitions for network loss recovery
    const handleOnline = () => {
      if (syncGenRef.current === gen) {
        syncBackoffRef.current = 1000;
        const freshGen = ++syncGenRef.current;
        void syncLoop(freshGen);
      }
    };
    window.addEventListener('online', handleOnline);

    // Capture ref for cleanup (React warns about stale refs in cleanup)
    const ref = syncGenRef;
    return () => {
      // Bump generation again so the loop exits on next check
      ref.current++;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
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
    setRecentlySentIds((prev) => new Set(prev).add(optimisticId));
    // Clear animation class after animation completes
    setTimeout(() => {
      setRecentlySentIds((prev) => {
        const next = new Set(prev);
        next.delete(optimisticId);
        return next;
      });
    }, 400);
    // Trigger send button launch animation
    setSendButtonAnimating(true);
    setTimeout(() => setSendButtonAnimating(false), 350);
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

      // Attach viewOnce flag to the outer (unencrypted) wrapper so the server
      // can detect view-once messages for auto-cleanup without decrypting.
      if (isViewOnce) {
        encryptedContent.viewOnce = true;
      }

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
      showToast?.('error', 'Failed to send. Tap message to retry.', {
        dedupeKey: 'send-fail',
        duration: 4000,
      });
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

  // ── Reaction handlers ──

  const handleShowReactionPicker = (e: React.MouseEvent, eventId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setReactionPickerEventId(eventId);
    setReactionPickerPos({ x: rect.left, y: rect.top - 44 });
  };

  const handleReact = async (eventId: string, emoji: string) => {
    setReactionPickerEventId(null);
    setReactionPickerPos(null);
    try {
      const result = await reactToMessage(eventId, emoji);
      setLocalReactions((prev) => ({ ...prev, [eventId]: result.reactions }));
    } catch (err) {
      console.error('Failed to react:', err);
    }
  };

  // ── Read receipt: mark messages as read when they become visible ──

  useEffect(() => {
    if (messages.length === 0) return;
    // Mark the latest non-own message as read
    const latestOther = [...messages]
      .reverse()
      .find((m) => m.event.senderId !== currentUserId);
    if (latestOther && !readEventIds.has(latestOther.event.eventId)) {
      setReadEventIds((prev) => new Set(prev).add(latestOther.event.eventId));
      markAsRead(latestOther.event.eventId).catch((err) =>
        console.error('Failed to send read receipt:', err),
      );
    }
  }, [messages, currentUserId, readEventIds]);

  // Close context menu, disappearing menu, and reaction picker on click anywhere
  useEffect(() => {
    const handleClick = () => {
      setContextMenuEventId(null);
      setContextMenuPos(null);
      setShowDisappearingMenu(false);
      setReactionPickerEventId(null);
      setReactionPickerPos(null);
    };
    if (contextMenuEventId || showDisappearingMenu || reactionPickerEventId) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenuEventId, showDisappearingMenu, reactionPickerEventId]);

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

    const isPulsing = recentlyEncryptedIds.has(decrypted.event.eventId);
    return (
      <span
        style={{
          ...styles.encryptionLock,
          ...(isPulsing
            ? { animation: 'frame-lock-pulse 0.8s ease-out', display: 'inline-block' }
            : {}),
        }}
        title="Encrypted"
      >
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

      const hasPopIn = recentlyArrivedIds.has(event.eventId);
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
            ...(hasPopIn
              ? { animation: 'frame-msg-pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }
              : {}),
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
                  {hasError ? (
                    <span style={styles.decryptErrorInline}>
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                        <circle cx="7" cy="7" r="6" stroke="#f85149" strokeWidth="1.2" fill="rgba(248,81,73,0.15)" />
                        <path d="M7 4v3" stroke="#f85149" strokeWidth="1.2" strokeLinecap="round" />
                        <circle cx="7" cy="9.5" r="0.6" fill="#f85149" />
                      </svg>
                      <span
                        style={styles.errorText}
                        title={decrypted.decryptionError
                          ? `Decryption failed: ${decrypted.decryptionError}. The sender may need to re-share session keys.`
                          : 'Message content could not be decrypted. The encryption session may have expired.'}
                      >
                        Unable to decrypt
                      </span>
                    </span>
                  ) : (
                    <span>{renderMessageContent(decrypted)}</span>
                  )}
                </>
              )}
            </div>
            {/* Timestamp + read receipts — only on last message of a group */}
            {isLastInGroup && (
              <div style={styles.timestampRow}>
                <span style={styles.timestamp}>
                  {formatRelativeTime(event.originServerTs)}
                </span>
                {isOwn && (
                  <span style={styles.readReceiptIcon} title="Sent">
                    {'\u2713'}
                  </span>
                )}
              </div>
            )}
            {/* Reactions display */}
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
                      style={{
                        ...styles.reactionBadge,
                        // eslint-disable-next-line
                      ...(reactions[emoji].users.includes(currentUserId)
                          ? styles.reactionBadgeOwn
                          : {}),
                      }}
                      onClick={() => void handleReact(event.eventId, emoji)}
                      // eslint-disable-next-line
                      title={reactions[emoji].users.map((u: string) => formatDisplayName(u)).join(', ')}
                    >
                      {/* eslint-disable-next-line */}
                      {emoji} {reactions[emoji].count}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
          {/* Reaction add button — appears on hover */}
          {!isDeleted && !isExpired && (
            <button
              type="button"
              style={styles.addReactionButton}
              onClick={(e) => handleShowReactionPicker(e, event.eventId)}
              title="Add reaction"
              aria-label="Add reaction"
            >
              +
            </button>
          )}
        </div>
      );

      lastSenderId = event.senderId;
      lastTimestamp = msgDate;
      lastDate = msgDate;
    }

    return elements;
  };

  // ── Welcome message for empty rooms ──

  const [e2eeExpanded, setE2eeExpanded] = useState(false);

  const renderWelcome = () => {
    if (messages.length > 0 || optimisticMessages.length > 0) return null;

    const isGroup = roomType === 'group';
    const otherUserId = !isGroup ? memberUserIds.find((id) => id !== currentUserId) : undefined;
    const avatarInitial = headerName ? headerName.charAt(0).toUpperCase() : '?';
    const avatarColor = otherUserId ? getAvatarColor(otherUserId) : '#58a6ff';

    return (
      <div style={styles.welcomeContainer}>
        {/* Avatar + name for DMs, icon for groups */}
        {!isGroup && (
          <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', marginBottom: 8 }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', backgroundColor: avatarColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 700, color: '#ffffff', marginBottom: 8,
            }}>
              {avatarInitial}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#e6edf3' }}>{headerName}</div>
          </div>
        )}
        <div style={{
          ...styles.welcomeIconWrap,
          animation: 'frame-welcome-float 3s ease-in-out infinite',
        }}>
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

        {/* Expandable E2EE explainer */}
        <button
          type="button"
          onClick={() => setE2eeExpanded((v) => !v)}
          style={{
            marginTop: 16, background: 'none', border: '1px solid #30363d', borderRadius: 8,
            padding: '8px 14px', color: '#8b949e', fontSize: 12, cursor: 'pointer',
            fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.color = '#c9d1d9'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: e2eeExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          What makes this conversation secure?
        </button>
        {e2eeExpanded && (
          <div style={{
            marginTop: 8, padding: '12px 16px', backgroundColor: 'rgba(88,166,255,0.04)',
            border: '1px solid #30363d', borderRadius: 8, textAlign: 'left' as const,
            maxWidth: 340, width: '100%',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginTop: 2, flexShrink: 0 }}><rect x="2" y="6" width="10" height="7" rx="1.5" stroke="#3fb950" strokeWidth="1.2" fill="none" /><path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="#3fb950" strokeWidth="1.2" fill="none" /></svg>
              <span style={{ fontSize: 12, color: '#c9d1d9', lineHeight: 1.5 }}>Messages are encrypted on your device before sending and can only be decrypted by the recipient.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginTop: 2, flexShrink: 0 }}><path d="M7 1L2 3.5v3.5c0 3 1.8 5 5 6 3.2-1 5-3 5-6V3.5L7 1z" stroke="#58a6ff" strokeWidth="1.2" strokeLinejoin="round" fill="none" /></svg>
              <span style={{ fontSize: 12, color: '#c9d1d9', lineHeight: 1.5 }}>The server never has access to your encryption keys or message content.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginTop: 2, flexShrink: 0 }}><circle cx="7" cy="7" r="5.5" stroke="#bc8cff" strokeWidth="1.2" fill="none" /><path d="M5 7l1.5 1.5L9.5 5" stroke="#bc8cff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
              <span style={{ fontSize: 12, color: '#c9d1d9', lineHeight: 1.5 }}>Verify your contact&apos;s fingerprint to ensure you are talking to the right person.</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ ...styles.container, ...(isMobile ? { borderRadius: 0, border: 'none' } : {}) }}>
      {/* Room header */}
      <div style={{
        ...styles.header,
        ...(isMobile ? { padding: '6px 10px', gap: 4 } : {}),
      }}>
        <div style={styles.headerLeft}>
          <div style={styles.headerNameRow}>
            {/* Stacked member avatars for group rooms */}
            {roomType === 'group' && memberUserIds.length > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                marginRight: 6,
                flexShrink: 0,
              }}>
                {memberUserIds
                  .filter((id) => id !== currentUserId)
                  .slice(0, 3)
                  .map((userId, idx) => (
                    <div
                      key={userId}
                      title={formatDisplayName(userId)}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        backgroundColor: getAvatarColor(userId),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#fff',
                        border: '2px solid #161b22',
                        marginLeft: idx === 0 ? 0 : -8,
                        zIndex: 3 - idx,
                        position: 'relative' as const,
                      }}
                    >
                      {formatDisplayName(userId).charAt(0).toUpperCase()}
                    </div>
                  ))}
                {memberUserIds.filter((id) => id !== currentUserId).length > 3 && (
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      backgroundColor: '#30363d',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      fontWeight: 700,
                      color: '#c9d1d9',
                      border: '2px solid #161b22',
                      marginLeft: -8,
                      zIndex: 0,
                      position: 'relative' as const,
                    }}
                  >
                    +{memberUserIds.filter((id) => id !== currentUserId).length - 3}
                  </div>
                )}
              </div>
            )}
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
                  ...(isMobile ? { maxWidth: '50vw', fontSize: 13 } : {}),
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
            {isSyncing && <SyncIndicator />}
            {roomType === 'group' && memberCount != null && memberCount > 0 && (
              <span style={styles.headerMemberCount}>
                {memberCount} member{memberCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 6, position: 'relative' as const }}>
          {!isMobile && <button
            type="button"
            style={{
              ...styles.disappearingButton,
              ...(disappearingSettings?.enabled ? styles.disappearingButtonActive : {}),
            }}
            title="Disappearing messages"
            onClick={() => setShowDisappearingMenu(!showDisappearingMenu)}
          >
            {disappearingSettings?.enabled ? 'Auto-delete ON' : 'Auto-delete'}
          </button>}
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
          {!isMobile && onLeave && (
            <button
              type="button"
              style={styles.leaveButton}
              title="Leave conversation"
              onClick={onLeave}
            >
              Leave
            </button>
          )}
          {/* Mobile: "..." more menu for auto-delete, settings, leave */}
          {isMobile && (
            <>
              <button
                type="button"
                style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #30363d', backgroundColor: 'transparent', color: '#8b949e', fontSize: 18, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', flexShrink: 0, minWidth: 44, minHeight: 44 }}
                title="More options"
                onClick={() => setShowMobileMoreMenu(!showMobileMoreMenu)}
                aria-label="More options"
              >
                &#8943;
              </button>
              {showMobileMoreMenu && (
                <div style={{ position: 'absolute' as const, top: '100%', right: 0, marginTop: 4, backgroundColor: '#21262d', border: '1px solid #30363d', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: 6, zIndex: 100, minWidth: 170, animation: 'frame-context-menu-in 0.15s ease-out' }}>
                  <button type="button" style={{ display: 'block', width: '100%', padding: '10px 12px', fontSize: 13, color: disappearingSettings?.enabled ? '#d29922' : '#c9d1d9', backgroundColor: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', textAlign: 'left' as const, fontFamily: 'inherit', minHeight: 44 }} onClick={() => { setShowMobileMoreMenu(false); setShowDisappearingMenu(!showDisappearingMenu); }}>
                    {disappearingSettings?.enabled ? 'Auto-delete ON' : 'Auto-delete'}
                  </button>
                  <button type="button" style={{ display: 'block', width: '100%', padding: '10px 12px', fontSize: 13, color: '#c9d1d9', backgroundColor: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', textAlign: 'left' as const, fontFamily: 'inherit', minHeight: 44 }} onClick={() => { setShowMobileMoreMenu(false); onOpenSettings?.(); }}>
                    Room Settings
                  </button>
                  {onLeave && (
                    <button type="button" style={{ display: 'block', width: '100%', padding: '10px 12px', fontSize: 13, color: '#f85149', backgroundColor: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', textAlign: 'left' as const, fontFamily: 'inherit', minHeight: 44 }} onClick={() => { setShowMobileMoreMenu(false); onLeave(); }}>
                      Leave Conversation
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {!isMobile && (
            <button
              type="button"
              style={styles.infoButton}
              title="Room info"
              onClick={() => onOpenSettings?.()}
            >
              i
            </button>
          )}
        </div>
      </div>

      {/* Sync error — subtle inline indicator instead of blocking banner */}
      {syncError && (
        <div style={styles.syncErrorIndicator}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="7" cy="7" r="6" stroke="#d29922" strokeWidth="1.2" fill="rgba(210,153,34,0.1)" />
            <path d="M7 4v3.5" stroke="#d29922" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="7" cy="10" r="0.7" fill="#d29922" />
          </svg>
          <span style={{ fontSize: 11, color: '#d29922' }}>Sync paused — retrying</span>
        </div>
      )}

      {/* Message list */}
      <div
        ref={messageListRef}
        style={styles.messageList}
        onScroll={handleScroll}
      >
        {showRoomSkeleton ? (
          /* Skeleton loading state: 3 placeholder bubbles while room loads */
          <div style={{ display: 'flex', flexDirection: 'column', padding: '16px 12px', gap: 4 }}>
            <SkeletonMessageBubble align="left" widthPercent={55} />
            <SkeletonMessageBubble align="right" widthPercent={45} />
            <SkeletonMessageBubble align="left" widthPercent={50} />
          </div>
        ) : (
          <>
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
              ...(recentlySentIds.has(om.id)
                ? { animation: 'frame-msg-slide-up 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }
                : {}),
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
          </>
        )}
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
        {/* View-once toggle — smaller on mobile */}
        <button
          type="button"
          style={{
            ...styles.viewOnceToggle,
            ...(viewOnceMode ? styles.viewOnceToggleActive : {}),
            ...(isMobile ? { padding: '4px 6px', fontSize: 12, width: 28, height: 28, minWidth: 28, minHeight: 28 } : {}),
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
            ...(isMobile ? { padding: '12px 14px', fontSize: 16, minHeight: 48 } : {}),
            ...(isTextareaFocused
              ? {
                  borderColor: '#58a6ff',
                  animation: 'frame-textarea-glow 2s ease-in-out infinite',
                  outline: 'none',
                }
              : {}),
          }}
          value={inputValue}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsTextareaFocused(true)}
          onBlur={() => setIsTextareaFocused(false)}
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
            ...(sendButtonAnimating
              ? { animation: 'frame-send-launch 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }
              : {}),
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
            className="frame-context-menu-item"
            style={styles.contextMenuItem}
            onClick={() => void handleDeleteMessage(contextMenuEventId)}
          >
            Delete
          </button>
        </div>
      )}

      {/* Reaction picker overlay */}
      {reactionPickerEventId && reactionPickerPos && (
        <div
          style={{
            ...styles.reactionPicker,
            top: reactionPickerPos.y,
            left: reactionPickerPos.x,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              style={styles.reactionPickerEmoji}
              onClick={() => void handleReact(reactionPickerEventId, emoji)}
            >
              {emoji}
            </button>
          ))}
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
  syncErrorIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 14px',
    backgroundColor: 'rgba(210, 153, 34, 0.08)',
    borderBottom: '1px solid rgba(210, 153, 34, 0.15)',
  },
  messageList: {
    flex: 1,
    overflowY: 'auto',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    scrollBehavior: 'smooth' as const,
    WebkitOverflowScrolling: 'touch' as const,
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
  decryptErrorInline: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    cursor: 'help',
  },
  errorText: {
    fontStyle: 'italic',
    opacity: 0.8,
    fontSize: 13,
    borderBottom: '1px dotted rgba(248, 81, 73, 0.4)',
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
    backgroundColor: '#1c2128',
    border: '1px solid rgba(99, 110, 123, 0.35)',
    borderRadius: 10,
    boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
    padding: 6,
    minWidth: 140,
    backdropFilter: 'blur(12px)',
    animation: 'frame-context-menu-in 0.15s ease-out',
  },
  contextMenuItem: {
    display: 'block',
    width: '100%',
    padding: '8px 14px',
    fontSize: 13,
    color: '#f85149',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontFamily: 'inherit',
    transition: 'background-color 0.12s',
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

  // ── Reactions ──
  reactionsRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
    marginTop: 4,
  },
  reactionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '2px 6px',
    fontSize: 12,
    borderRadius: 10,
    border: '1px solid #30363d',
    backgroundColor: 'rgba(33, 38, 45, 0.8)',
    color: '#c9d1d9',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s, background-color 0.15s',
    lineHeight: 1.3,
  },
  reactionBadgeOwn: {
    borderColor: '#58a6ff',
    backgroundColor: 'rgba(88, 166, 255, 0.15)',
  },
  addReactionButton: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    border: '1px solid #30363d',
    backgroundColor: 'transparent',
    color: '#8b949e',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    alignSelf: 'center',
    opacity: 0,
    transition: 'opacity 0.15s, border-color 0.15s',
    fontFamily: 'inherit',
  },
  reactionPicker: {
    position: 'fixed' as const,
    zIndex: 9999,
    display: 'flex',
    gap: 2,
    padding: '4px 6px',
    backgroundColor: '#1c2128',
    border: '1px solid rgba(99, 110, 123, 0.35)',
    borderRadius: 20,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    backdropFilter: 'blur(12px)',
    animation: 'frame-context-menu-in 0.15s ease-out',
  },
  reactionPickerEmoji: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '50%',
    cursor: 'pointer',
    transition: 'background-color 0.12s, transform 0.12s',
    fontFamily: 'inherit',
  },

  // ── Read receipts ──
  readReceiptIcon: {
    fontSize: 11,
    color: '#3fb950',
    opacity: 0.8,
    marginLeft: 2,
  },
};

export default ChatWindow;
