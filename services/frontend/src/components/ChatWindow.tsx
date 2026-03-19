import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
import { sendMessage, deleteMessage, syncMessages, SyncEvent, reactToMessage, markAsRead, ReactionData, setTyping, getTypingUsers } from '../api/messagesAPI';
import { renameRoom, listRooms, getRoomMembers } from '../api/roomsAPI';
import type { RoomSummary } from '../api/roomsAPI';
import { formatDisplayName } from '../utils/displayName';
import { getUserStatus } from '../api/authAPI';
import type { UserStatus } from '../api/authAPI';
import {
  encryptForRoom,
  decryptEvent,
  processSyncResponse,
  ensureSessionsForRoom,
  DecryptedEvent,
} from '../crypto/sessionManager';
import { FONT_BODY } from '../globalStyles';
import { useIsMobile } from '../hooks/useIsMobile';
import { SkeletonMessageBubble, SyncIndicator } from './Skeleton';
import { playMessageSound, playSendSound, playErrorSound } from '../sounds';

// ── Reaction Picker ──

const QUICK_REACTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F44F}'];

// ── Status helpers ──

const STATUS_COLORS: Record<UserStatus, string> = {
  online: '#3fb950',
  away: '#d29922',
  busy: '#f85149',
  offline: '#484f58',
};

const STATUS_LABELS: Record<UserStatus, string> = {
  online: 'Online',
  away: 'Away',
  busy: 'Busy',
  offline: 'Offline',
};

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
  isAnonymous?: boolean;
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

// ── Emoji grid for picker ──
const CHAT_EMOJIS = [
  '\u{1F600}', '\u{1F602}', '\u{1F605}', '\u{1F609}', '\u{1F60D}', '\u{1F618}',
  '\u{1F970}', '\u{1F914}', '\u{1F923}', '\u{1F62D}', '\u{1F621}', '\u{1F631}',
  '\u{1F44D}', '\u{1F44E}', '\u{1F44B}', '\u{1F64F}', '\u{1F525}', '\u{2764}\u{FE0F}',
  '\u{1F389}', '\u{1F44F}', '\u{1F4AF}', '\u{1F440}', '\u{2705}', '\u{274C}',
];

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
  isAnonymous,
  onOpenSettings,
  onRoomRenamed,
  onLeave,
  showToast,
}) => {
  const isMobile = useIsMobile(600);
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

  // Typing indicator state
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTypingSentRef = useRef<number>(0);

  // Message forwarding state
  const [forwardEventId, setForwardEventId] = useState<string | null>(null);
  const [forwardRooms, setForwardRooms] = useState<RoomSummary[]>([]);
  const [showForwardDialog, setShowForwardDialog] = useState(false);

  // ── Feature: Search within chat ──
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Feature: Pinned messages ──
  const [pinnedEventIds, setPinnedEventIds] = useState<string[]>([]);
  const [showPinnedBar, setShowPinnedBar] = useState(true);

  // ── Feature: Unread message divider ──
  const [unreadDividerEventId, setUnreadDividerEventId] = useState<string | null>(null);
  const hasSetUnreadDividerRef = useRef(false);

  // ── Feature: Double-tap to react ──
  const lastClickTimeRef = useRef<Record<string, number>>({});

  // Reply state
  const [replyTo, setReplyTo] = useState<{ eventId: string; senderId: string; body: string } | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Contact status for DM header
  const [contactStatus, setContactStatus] = useState<UserStatus>('offline');
  const [contactStatusHovered, setContactStatusHovered] = useState(false);

  // SECURITY: Proactively establish Olm sessions and share Megolm keys when
  // entering a room. This ensures that when a user joins via invite code or
  // other method, they can immediately decrypt messages from existing members
  // (who will receive the key-share request and re-share their session keys).
  // Without this, decryption only works after the next message send.
  useEffect(() => {
    if (!roomId || memberUserIds.length === 0) return;
    let cancelled = false;

    async function establishSessions() {
      try {
        await ensureSessionsForRoom(roomId, memberUserIds);
      } catch (err) {
        if (!cancelled) {
          console.warn('[F.R.A.M.E.] Proactive session establishment failed:', err);
        }
      }
    }

    void establishSessions();
    return () => { cancelled = true; };
  }, [roomId, memberUserIds]);

  // Fetch contact status for DM rooms and poll every 30 seconds
  useEffect(() => {
    if (roomType !== 'direct') return;
    const otherUserId = memberUserIds.find((id) => id !== currentUserId);
    if (!otherUserId) return;

    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await getUserStatus(otherUserId);
        if (!cancelled) setContactStatus(res.status);
      } catch {
        // Silently default to offline on error
      }
    };

    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [roomId, roomType, memberUserIds, currentUserId]);

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
  const syncBackoffRef = useRef(1000);
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
  // Mobile "more" menu state (bottom sheet for auto-delete / leave / info)
  const [showMobileMoreMenu, setShowMobileMoreMenu] = useState(false);
  // Mobile emoji bottom sheet
  const [showMobileEmojiSheet, setShowMobileEmojiSheet] = useState(false);
  // Long-press timer for mobile context menu
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  // Rotating placeholder index
  const [placeholderIndex, setPlaceholderIndex] = useState(() => Math.floor(Math.random() * 5));
  const emojiPickerRef = useRef<HTMLDivElement>(null);

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

  // Rotate placeholder text when input is empty and focused
  const INPUT_PLACEHOLDERS = [
    'Type a message...',
    'Say something encrypted...',
    'Your message is E2EE protected...',
    'Write a secure message...',
    "What's on your mind?",
  ];
  useEffect(() => {
    if (!isTextareaFocused || inputValue.length > 0) return;
    const timer = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % INPUT_PLACEHOLDERS.length);
    }, 4000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTextareaFocused, inputValue]);

  // Re-focus textarea after send completes (when isSending flips back to false).
  // This is more reliable than setTimeout because it fires after React re-renders
  // the textarea as enabled (disabled={isSending}).
  useEffect(() => {
    if (!isSending) {
      textareaRef.current?.focus();
    }
  }, [isSending]);

  const insertEmojiAtCursor = (emoji: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart ?? inputValue.length;
      const end = ta.selectionEnd ?? inputValue.length;
      const newVal = inputValue.slice(0, start) + emoji + inputValue.slice(end);
      setInputValue(newVal);
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
        textarea::placeholder { color: #8b949e; }
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
        @keyframes frame-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .frame-context-menu-item:hover {
          background-color: rgba(248, 81, 73, 0.15) !important;
        }
        .frame-msg-row:hover > .frame-msg-hover-actions {
          opacity: 1 !important;
        }
        .frame-msg-hover-action:hover {
          color: #c9d1d9 !important;
          background-color: rgba(139, 148, 158, 0.12) !important;
        }
        @media (hover: none) {
          .frame-msg-hover-actions {
            opacity: 0.5 !important;
          }
          .frame-msg-hover-action {
            width: 20px !important;
            height: 20px !important;
          }
        }
        .frame-reaction-emoji:hover {
          background-color: rgba(88, 166, 255, 0.15) !important;
          transform: scale(1.2) !important;
        }
        .frame-reaction-badge:hover {
          border-color: #58a6ff !important;
        }
        @keyframes frame-bottom-sheet-slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes frame-overlay-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Fetch disappearing messages settings + pinned messages
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getRoomSettingsAPI } = await import('../api/roomsAPI');
        const resp = await getRoomSettingsAPI(roomId);
        if (!cancelled) {
          if (resp.settings?.disappearingMessages) {
            setDisappearingSettings(resp.settings.disappearingMessages as { enabled: boolean; timeoutSeconds: number });
          }
          if (resp.settings?.pinnedEventIds && Array.isArray(resp.settings.pinnedEventIds)) {
            setPinnedEventIds(resp.settings.pinnedEventIds as string[]);
          }
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
          setMessages((prev) =>
            prev.map((m) =>
              m.event.eventId === eventId
                ? { ...m, plaintext: null, decryptionError: 'View-once message already viewed' }
                : m,
            ),
          );
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

  const syncLoop = useCallback(async (gen: number) => {
    while (syncGenRef.current === gen) {
      try {
        const result = await syncMessages(nextBatchRef.current, 10000, 50);

        if (syncGenRef.current !== gen) break;

        // Only flash sync indicator briefly when events actually arrive
        if (result.events.length > 0) {
          setIsSyncing(true);
          setTimeout(() => setIsSyncing(false), 600);
        }

        await processSyncResponse(result);
        nextBatchRef.current = result.nextBatch;

        if (result.events.length > 0) {
          const roomEvents = result.events.filter((e) => e.roomId === roomId);
          const decryptedEvents = roomEvents.length > 0
            ? await decryptEvents(roomEvents)
            : [];

          if (syncGenRef.current !== gen) break;

          if (decryptedEvents.length > 0) {
            // Set unread divider on first batch of new messages from others
            const hasMessageFromOther = decryptedEvents.some((e) => e.event.senderId !== currentUserId);
            if (!hasSetUnreadDividerRef.current) {
              const firstFromOther = decryptedEvents.find((e) => e.event.senderId !== currentUserId);
              if (firstFromOther) {
                setUnreadDividerEventId(firstFromOther.event.eventId);
                hasSetUnreadDividerRef.current = true;
              }
            }
            // Play incoming message sound when a new message arrives from someone else
            if (hasMessageFromOther) {
              playMessageSound();
            }
            setMessages((prev) => [...prev, ...decryptedEvents]);
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
        syncBackoffRef.current = 1000;
      } catch (err) {
        if (syncGenRef.current !== gen) break;
        // Show a subtle reconnecting indicator — NOT a blocking error.
        // The loop keeps running with exponential backoff so it will
        // recover automatically once the issue resolves.
        setSyncError('reconnecting');
        const delay = syncBackoffRef.current;
        syncBackoffRef.current = Math.min(delay * 2, 30000);
        await new Promise((r) => setTimeout(r, delay));
        // Continue the while-loop — NEVER stop trying
      }
    }
  }, [decryptEvents, roomId]);

  useEffect(() => {
    setShowRoomSkeleton(true);
    const timer = setTimeout(() => setShowRoomSkeleton(false), 200);
    return () => clearTimeout(timer);
  }, [roomId]);

  useEffect(() => {
    if (messages.length > 0 && showRoomSkeleton) {
      setShowRoomSkeleton(false);
    }
  }, [messages.length, showRoomSkeleton]);

  useEffect(() => {
    setMessages([]);
    setOptimisticMessages([]);
    nextBatchRef.current = undefined;
    syncBackoffRef.current = 1000;
    setShowSearch(false);
    setSearchQuery('');
    setPinnedEventIds([]);
    setShowPinnedBar(true);
    setUnreadDividerEventId(null);
    hasSetUnreadDividerRef.current = false;

    const gen = ++syncGenRef.current;

    const timer = setTimeout(() => {
      void syncLoop(gen);
    }, 0);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && syncGenRef.current === gen) {
        syncBackoffRef.current = 1000;
        const freshGen = ++syncGenRef.current;
        void syncLoop(freshGen);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleOnline = () => {
      if (syncGenRef.current === gen) {
        syncBackoffRef.current = 1000;
        const freshGen = ++syncGenRef.current;
        void syncLoop(freshGen);
      }
    };
    window.addEventListener('online', handleOnline);

    const ref = syncGenRef;
    return () => {
      ref.current++;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [roomId, syncLoop]);

  // ── Feature: Copy message text to clipboard ──
  const handleCopyText = useCallback((eventId: string) => {
    setContextMenuEventId(null);
    setContextMenuPos(null);
    const msg = messages.find((m) => m.event.eventId === eventId);
    if (!msg) return;
    const body = msg.plaintext && typeof msg.plaintext.body === 'string'
      ? msg.plaintext.body
      : renderMessageContent(msg);
    navigator.clipboard.writeText(body).then(() => {
      showToast?.('success', 'Message copied to clipboard');
    }).catch(() => {
      showToast?.('error', 'Failed to copy message');
    });
  }, [messages, showToast]);

  // ── Feature: Pin/unpin message ──
  const handleTogglePin = useCallback(async (eventId: string) => {
    setContextMenuEventId(null);
    setContextMenuPos(null);
    const isPinned = pinnedEventIds.includes(eventId);
    const newPinned = isPinned
      ? pinnedEventIds.filter((id) => id !== eventId)
      : [...pinnedEventIds, eventId];
    setPinnedEventIds(newPinned);
    try {
      const { updateRoomSettings } = await import('../api/roomsAPI');
      await updateRoomSettings(roomId, { pinnedEventIds: newPinned });
      showToast?.('success', isPinned ? 'Message unpinned' : 'Message pinned');
    } catch (err) {
      console.error('Failed to update pinned messages:', err);
      setPinnedEventIds(pinnedEventIds); // rollback
      showToast?.('error', 'Failed to update pinned messages');
    }
  }, [pinnedEventIds, roomId, showToast]);

  // ── Feature: Double-click to toggle heart reaction ──
  const handleReactRef = useRef<((eventId: string, emoji: string) => Promise<void>) | null>(null);

  // Reply handler — triggered from context menu
  const handleReplyToMessage = useCallback((eventId: string) => {
    setContextMenuEventId(null);
    setContextMenuPos(null);
    const msg = messages.find((m) => m.event.eventId === eventId);
    if (!msg) return;
    const body = msg.plaintext && typeof msg.plaintext.body === 'string'
      ? msg.plaintext.body
      : 'Message';
    setReplyTo({ eventId, senderId: msg.event.senderId, body });
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [messages]);

  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  // Scroll to a referenced message
  const scrollToMessage = useCallback((eventId: string) => {
    const el = messageRefs.current[eventId]; // eslint-disable-line security/detect-object-injection
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background-color 0.3s';
      el.style.backgroundColor = 'rgba(88, 166, 255, 0.15)';
      setTimeout(() => { el.style.backgroundColor = ''; }, 1200);
    }
  }, []);

  const handleSend = async (retryText?: string) => {
    const text = retryText || inputValue.trim();
    if (!text || isSending) return;

    const isViewOnce = viewOnceMode;
    const currentReplyTo = replyTo;

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
    setTimeout(() => {
      setRecentlySentIds((prev) => {
        const next = new Set(prev);
        next.delete(optimisticId);
        return next;
      });
    }, 400);
    setSendButtonAnimating(true);
    setTimeout(() => setSendButtonAnimating(false), 350);
    if (!retryText) {
      setInputValue('');
      setViewOnceMode(false);
      setReplyTo(null);
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
      if (currentReplyTo) {
        plaintext.replyTo = {
          eventId: currentReplyTo.eventId,
          senderId: currentReplyTo.senderId,
          body: currentReplyTo.body.length > 100 ? currentReplyTo.body.slice(0, 100) + '...' : currentReplyTo.body,
        };
      }

      const encryptedContent = await encryptForRoom(
        roomId,
        'm.room.message',
        plaintext,
        memberUserIds,
      );

      if (isViewOnce) {
        encryptedContent.viewOnce = true;
      }

      await sendMessage(roomId, 'm.room.encrypted', encryptedContent);

      playSendSound();
      setOptimisticMessages((prev) =>
        prev.map((om) =>
          om.id === optimisticId ? { ...om, status: 'sent' as const } : om,
        ),
      );
    } catch (err) {
      console.error('Failed to send message:', err);
      playErrorSound();
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    const lineHeight = 20;
    const maxHeight = lineHeight * 5 + 16;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;

    // Send typing indicator (throttled to every 3 seconds)
    const now = Date.now();
    if (e.target.value.trim() && now - lastTypingSentRef.current > 3000) {
      lastTypingSentRef.current = now;
      setTyping(roomId, true).catch(() => undefined);
    }

    // Clear typing after 3 seconds of no input
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (e.target.value.trim()) {
      typingTimeoutRef.current = setTimeout(() => {
        setTyping(roomId, false).catch(() => undefined);
      }, 3000);
    } else {
      setTyping(roomId, false).catch(() => undefined);
    }
  };

  // ── Typing indicator polling ──
  useEffect(() => {
    const pollTyping = async () => {
      try {
        const result = await getTypingUsers(roomId);
        setTypingUsers(result.typingUserIds);
      } catch { /* ignore polling errors */ }
    };
    void pollTyping();
    const interval = setInterval(() => void pollTyping(), 2000);
    return () => {
      clearInterval(interval);
      setTypingUsers([]);
    };
  }, [roomId]);

  // Cleanup typing state on unmount or room change
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
      setTyping(roomId, false).catch(() => undefined);
    };
  }, [roomId]);

  // ── Message forwarding ──
  const handleForwardMessage = useCallback(async (eventId: string) => {
    setContextMenuEventId(null);
    setContextMenuPos(null);
    setForwardEventId(eventId);
    try {
      const rooms = await listRooms();
      setForwardRooms(rooms.filter((r) => r.roomId !== roomId));
      setShowForwardDialog(true);
    } catch (err) {
      console.error('Failed to load rooms for forwarding:', err);
    }
  }, [roomId]);

  const handleForwardToRoom = useCallback(async (targetRoomId: string, targetRoomName: string) => {
    if (!forwardEventId) return;
    const msg = messages.find((m) => m.event.eventId === forwardEventId);
    if (!msg || !msg.plaintext) return;

    const body = typeof msg.plaintext.body === 'string' ? msg.plaintext.body : JSON.stringify(msg.plaintext);
    try {
      // SECURITY: Fetch the TARGET room's members for encryption key distribution.
      // Using the current room's memberUserIds would share the Megolm session key
      // with the wrong set of users, breaking E2EE confidentiality.
      const targetMembers = await getRoomMembers(targetRoomId);
      const targetMemberUserIds = targetMembers.map((m) => m.userId);

      const plaintext: Record<string, unknown> = {
        msgtype: 'm.text',
        body,
      };
      const encryptedContent = await encryptForRoom(
        targetRoomId,
        'm.room.message',
        plaintext,
        targetMemberUserIds,
      );
      await sendMessage(targetRoomId, 'm.room.encrypted', encryptedContent);
      showToast?.('success', `Message forwarded to ${targetRoomName}`);
    } catch (err) {
      console.error('Failed to forward message:', err);
      showToast?.('error', 'Failed to forward message');
    }
    setShowForwardDialog(false);
    setForwardEventId(null);
  }, [forwardEventId, messages, showToast]);

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

  // Keep ref in sync for double-click handler
  handleReactRef.current = handleReact;

  const handleMessageClick = useCallback((e: React.MouseEvent, eventId: string) => {
    const now = Date.now();
    const lastClick = lastClickTimeRef.current[eventId] || 0; // eslint-disable-line security/detect-object-injection
    if (now - lastClick < 350) {
      // Double-click detected — toggle heart reaction
      void handleReactRef.current?.(eventId, '\u2764\uFE0F');
      lastClickTimeRef.current[eventId] = 0; // eslint-disable-line security/detect-object-injection
    } else {
      lastClickTimeRef.current[eventId] = now; // eslint-disable-line security/detect-object-injection
    }
  }, []);

  // ── Long-press handlers for mobile context menu (item 10) ──
  const handleTouchStart = useCallback((eventId: string, senderId: string) => {
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      if (deletedEventIds.has(eventId)) return;
      setContextMenuEventId(eventId);
      // On mobile, position doesn't matter — we render as bottom sheet
      setContextMenuPos({ x: 0, y: 0 });
    }, 500);
  }, [deletedEventIds]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (messages.length === 0) return;
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
    _senderId: string,
  ) => {
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
  };

  const renderEncryptionIcon = (decrypted: DecryptedEvent): React.ReactNode => {
    if (!decrypted.isEncrypted) return null;
    if (decrypted.decryptionError) {
      return (
        <span style={styles.previousSessionLock} title="Encrypted with keys from a previous session">
          &#128274;
        </span>
      );
    }
    const isPulsing = recentlyEncryptedIds.has(decrypted.event.eventId);
    return (
      <span
        style={{
          ...styles.encryptionLock,
          ...(isPulsing ? { animation: 'frame-lock-pulse 0.8s ease-out', display: 'inline-block' } : {}),
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
        return <span style={styles.statusIcon} title="Sending">&#128337;</span>;
      case 'sent':
        return <span style={styles.statusIconSent} title="Sent">&#10003;</span>;
      case 'failed':
        return <span style={styles.statusIconFailed} title="Failed to send">&#10007;</span>;
      default:
        return null;
    }
  };

  const headerName = roomDisplayName
    ? DOMPurify.sanitize(roomDisplayName, PURIFY_CONFIG)
    : DOMPurify.sanitize(roomId, PURIFY_CONFIG);

  /**
   * Resolve display name for a sender. In anonymous rooms, uses the
   * senderDisplayName from the sync event if available; falls back to "Anonymous".
   */
  const resolveDisplayName = useCallback((senderId: string, senderDisplayName?: string): string => {
    if (isAnonymous) {
      return senderDisplayName || 'Anonymous';
    }
    return formatDisplayName(senderId);
  }, [isAnonymous]);

  // Memoize message rendering — avoids recomputing grouping/date separators on
  // unrelated state changes (emoji picker, context menu, textarea focus, etc.)
  // Filtered messages for search
  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter((m) => {
      if (!m.plaintext || typeof m.plaintext.body !== 'string') return false;
      return m.plaintext.body.toLowerCase().includes(q);
    });
  }, [messages, searchQuery]);

  const renderedMessages = useMemo(() => {
    const msgsToRender = searchQuery.trim() ? filteredMessages : messages;
    const elements: React.ReactNode[] = [];
    let lastSenderId: string | null = null;
    let lastTimestamp: Date | null = null;
    let lastDate: Date | null = null;

    // Pre-compute runs of consecutive undecryptable messages for collapsing
    const undecryptableRunStart = new Set<number>();
    const undecryptableRunLength: Record<number, number> = {};
    const skipIndices = new Set<number>();
    {
      let runStart = -1;
      let runCount = 0;
      for (let j = 0; j <= msgsToRender.length; j++) {
        const msg = j < msgsToRender.length ? msgsToRender[j] : null; // eslint-disable-line security/detect-object-injection
        const isUndecryptable = msg !== null && msg.decryptionError !== null && !deletedEventIds.has(msg.event.eventId) && !expiredEventIds.has(msg.event.eventId);
        if (isUndecryptable) {
          if (runStart === -1) { runStart = j; runCount = 1; }
          else { runCount++; }
        } else {
          if (runStart !== -1 && runCount > 1) {
            undecryptableRunStart.add(runStart);
            // eslint-disable-next-line security/detect-object-injection
            undecryptableRunLength[runStart] = runCount;
            for (let k = runStart + 1; k < runStart + runCount; k++) skipIndices.add(k);
          }
          runStart = -1;
          runCount = 0;
        }
      }
    }

    for (const [i, decrypted] of msgsToRender.entries()) {
      // Skip messages that are part of a collapsed undecryptable run (except the first)
      if (skipIndices.has(i)) {
        lastSenderId = decrypted.event.senderId;
        lastTimestamp = new Date(decrypted.event.originServerTs);
        lastDate = lastTimestamp;
        continue;
      }

      const event = decrypted.event;
      const isOwn = event.senderId === currentUserId;
      const hasError = decrypted.decryptionError !== null;
      const msgDate = new Date(event.originServerTs);
      const isDeleted = deletedEventIds.has(event.eventId);
      const isExpired = expiredEventIds.has(event.eventId);
      const isViewOnce = decrypted.plaintext && decrypted.plaintext.viewOnce === true;
      const isHiddenOnce = hiddenOnceIds.has(event.eventId);
      // eslint-disable-next-line security/detect-object-injection
      const collapsedCount = undecryptableRunStart.has(i) ? undecryptableRunLength[i] : 0;

      if (!lastDate || isDifferentDay(lastDate, msgDate)) {
        elements.push(
          <div key={`date-${event.eventId}`} style={styles.dateSeparator}>
            <div style={styles.dateSeparatorLine} />
            <span className="frame-date-sep-text" style={{ ...styles.dateSeparatorText, ...(isMobile ? { fontSize: 10 } : {}) }}>{formatDateSeparator(msgDate)}</span>
            <div style={styles.dateSeparatorLine} />
          </div>
        );
      }

      // ── Feature: Unread message divider ──
      if (unreadDividerEventId && event.eventId === unreadDividerEventId && !searchQuery.trim()) {
        elements.push(
          <div key="unread-divider" style={styles.unreadDivider}>
            <div style={styles.unreadDividerLine} />
            <span style={styles.unreadDividerText}>New messages</span>
            <div style={styles.unreadDividerLine} />
          </div>
        );
      }

      const timeSinceLastMs = lastTimestamp ? msgDate.getTime() - lastTimestamp.getTime() : Infinity;
      const isSameSenderAsPrev = lastSenderId === event.senderId;
      const isNewGroup = !isSameSenderAsPrev || timeSinceLastMs > GROUP_GAP_MS;

      if (lastTimestamp && timeSinceLastMs > TIMESTAMP_GAP_MS && lastDate && !isDifferentDay(lastDate, msgDate)) {
        elements.push(
          <div key={`gap-${event.eventId}`} style={styles.timeGap}>
            <span style={styles.timeGapText}>{formatRelativeTime(msgDate)}</span>
          </div>
        );
      }

      if (isViewOnce && isHiddenOnce && !isOwn) {
        elements.push(
          <div key={event.eventId} style={{ ...styles.messageBubble, maxWidth: isMobile ? '85%' : 'clamp(200px, 75%, 600px)', ...styles.otherMessage, opacity: 0.5, alignSelf: 'flex-start' as const }}>
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

      // Render collapsed undecryptable run as a single informational block
      if (collapsedCount > 1) {
        elements.push(
          <div key={`prev-session-${event.eventId}`} style={styles.previousSessionBlock}>
            <div style={styles.previousSessionBlockInner}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="7" cy="7" r="6" stroke="#8b949e" strokeWidth="1.2" fill="rgba(139,148,158,0.08)" />
                <rect x="5" y="6.5" width="4" height="3.2" rx="0.6" stroke="#8b949e" strokeWidth="0.9" fill="none" />
                <path d="M6 6.5V5.2a1 1 0 0 1 2 0V6.5" stroke="#8b949e" strokeWidth="0.9" strokeLinecap="round" fill="none" />
              </svg>
              <span style={styles.previousSessionBlockText}>
                {collapsedCount} messages from a previous session
              </span>
              <span
                style={styles.previousSessionInfoIcon}
                title="These messages were encrypted with keys from a different login session. They cannot be decrypted on this device. This is expected behavior that protects forward secrecy."
              >
                i
              </span>
            </div>
            <span style={styles.previousSessionLearnMore}>
              End-to-end encryption uses unique keys per session for forward secrecy
            </span>
          </div>
        );
        const lastInRun = messages[i + collapsedCount - 1];
        lastSenderId = lastInRun.event.senderId;
        lastTimestamp = new Date(lastInRun.event.originServerTs);
        lastDate = lastTimestamp;
        continue;
      }

      const isFirstInGroup = isNewGroup;
      const nextMsg = messages[i + 1];
      const isLastInGroup = !nextMsg ||
        nextMsg.event.senderId !== event.senderId ||
        (new Date(nextMsg.event.originServerTs).getTime() - msgDate.getTime()) > GROUP_GAP_MS;

      const bubbleRadius = isOwn
        ? { borderTopLeftRadius: 12, borderTopRightRadius: isFirstInGroup ? 12 : 4, borderBottomLeftRadius: 12, borderBottomRightRadius: isLastInGroup ? 12 : 4 }
        : { borderTopLeftRadius: isFirstInGroup ? 12 : 4, borderTopRightRadius: 12, borderBottomLeftRadius: isLastInGroup ? 12 : 4, borderBottomRightRadius: 12 };

      const hasPopIn = recentlyArrivedIds.has(event.eventId);
      elements.push(
        <div
          key={event.eventId}
          ref={(el) => { messageRefs.current[event.eventId] = el; }}
          className="frame-msg-row"
          style={{
            display: 'flex', alignItems: 'flex-end', gap: 8,
            alignSelf: isOwn ? 'flex-end' : 'flex-start',
            maxWidth: isMobile ? '85%' : 'clamp(200px, 75%, 600px)',
            marginTop: isFirstInGroup ? 12 : 4,
            position: 'relative' as const,
            ...(hasPopIn ? { animation: 'frame-msg-pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' } : {}),
          }}
          onTouchStart={isMobile ? () => handleTouchStart(event.eventId, event.senderId) : undefined}
          onTouchEnd={isMobile ? handleTouchEnd : undefined}
          onTouchMove={isMobile ? handleTouchMove : undefined}
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
            style={{ ...styles.messageBubble, ...(isMobile ? { padding: '10px 14px', fontSize: 'clamp(14px, 3.8vw, 16px)' } : {}), ...(isOwn ? styles.ownMessage : styles.otherMessage), ...(hasError ? styles.previousSessionMessage : {}), ...bubbleRadius, marginTop: 0, position: 'relative' as const }}
            onContextMenu={isMobile ? undefined : (e) => handleMessageContextMenu(e, event.eventId, event.senderId)}
            onClick={(e) => handleMessageClick(e, event.eventId)}
          >
            {/* Reply quote block */}
            {decrypted.plaintext != null && Boolean(decrypted.plaintext.replyTo) && (() => {
              const rt = decrypted.plaintext.replyTo as { eventId: string; senderId: string; body: string };
              const replyColor = getAvatarColor(rt.senderId);
              const truncLen = isMobile ? 60 : 80;
              const replyPreview = typeof rt.body === 'string' && rt.body.length > truncLen ? rt.body.slice(0, truncLen) + '...' : rt.body;
              return (
                <div
                  style={{ borderLeft: `3px solid ${replyColor}`, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: '0 6px 6px 0', padding: '4px 8px', marginBottom: 4, cursor: 'pointer', maxWidth: '100%', overflow: 'hidden' }}
                  onClick={(e) => { e.stopPropagation(); scrollToMessage(rt.eventId); }}
                  title="Click to scroll to original message"
                >
                  <div style={{ fontSize: 10, fontWeight: 600, color: isAnonymous ? '#bc8cff' : replyColor, marginBottom: 1 }}>
                    {DOMPurify.sanitize(isAnonymous ? 'Anonymous' : formatDisplayName(rt.senderId), PURIFY_CONFIG)}
                  </div>
                  <div style={{ fontSize: 11, color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                    {typeof replyPreview === 'string' ? DOMPurify.sanitize(replyPreview, PURIFY_CONFIG) : 'Message'}
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
                  {renderEncryptionIcon(decrypted)}
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
                    <span>{(() => {
                      const text = renderMessageContent(decrypted);
                      if (!searchQuery.trim()) return text;
                      const q = searchQuery.toLowerCase();
                      const idx = text.toLowerCase().indexOf(q);
                      if (idx === -1) return text;
                      return (
                        <>
                          {text.slice(0, idx)}
                          <mark style={{ backgroundColor: 'rgba(210, 153, 34, 0.5)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>{text.slice(idx, idx + searchQuery.length)}</mark>
                          {text.slice(idx + searchQuery.length)}
                        </>
                      );
                    })()}</span>
                  )}
                </>
              )}
            </div>
            {isLastInGroup && (
              <div style={styles.timestampRow}>
                <span style={styles.timestamp}>{formatRelativeTime(event.originServerTs)}</span>
                {isOwn && <span style={styles.readReceiptIcon} title="Sent">{'\u2713'}</span>}
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
                      onClick={() => void handleReact(event.eventId, emoji)}
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
                onClick={() => handleReplyToMessage(event.eventId)}
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
                onClick={(e) => handleShowReactionPicker(e, event.eventId)}
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

      lastSenderId = event.senderId;
      lastTimestamp = msgDate;
      lastDate = msgDate;
    }

    return elements;
  }, [messages, filteredMessages, currentUserId, deletedEventIds, expiredEventIds, hiddenOnceIds, recentlyArrivedIds, recentlyEncryptedIds, localReactions, scrollToMessage, searchQuery, unreadDividerEventId, handleMessageClick, isMobile, handleTouchStart, handleTouchEnd, handleTouchMove]);

  const renderWelcome = () => {
    if (messages.length > 0 || optimisticMessages.length > 0) return null;
    const isGroup = roomType === 'group';
    return (
      <div style={styles.welcomeContainer}>
        <div style={{ ...styles.welcomeIconWrap, animation: 'frame-welcome-float 3s ease-in-out infinite' }}>
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
          {isGroup ? `Welcome to ${headerName}` : `This is the beginning of your encrypted conversation with ${headerName}`}
        </div>
        <div style={styles.welcomeSubtitle}>
          {isGroup ? 'Messages in this group are end-to-end encrypted.' : 'Messages are secured with end-to-end encryption.'}
        </div>
        <div style={{ ...styles.welcomeE2eeBadge, backgroundColor: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.2)' }}>
          <span style={{ fontSize: 12, filter: 'drop-shadow(0 0 3px rgba(63,185,80,0.5))' }}>&#128274;</span> F.R.A.M.E. E2EE
        </div>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {/* Room header -- compact on mobile (item 2) */}
      <div style={{ ...styles.header, padding: isMobile ? '6px 8px' : 'clamp(6px, 1vw, 10px) clamp(10px, 1.2vw, 14px)' }}>
        <div style={styles.headerLeft}>
          <div style={styles.headerNameRow}>
            {roomType === 'group' && memberUserIds.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', marginRight: 6, flexShrink: 0 }}>
                {isAnonymous ? (
                  <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: '#6e40aa', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #161b22' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                      <line x1="2" y1="2" x2="22" y2="22" />
                    </svg>
                  </div>
                ) : (
                  <>
                    {memberUserIds.filter((id) => id !== currentUserId).slice(0, 3).map((userId, idx) => (
                      <div key={userId} title={formatDisplayName(userId)} style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: getAvatarColor(userId), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', border: '2px solid #161b22', marginLeft: idx === 0 ? 0 : -8, zIndex: 3 - idx, position: 'relative' as const }}>
                        {formatDisplayName(userId).charAt(0).toUpperCase()}
                      </div>
                    ))}
                    {memberUserIds.filter((id) => id !== currentUserId).length > 3 && (
                      <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: '#30363d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#c9d1d9', border: '2px solid #161b22', marginLeft: -8, zIndex: 0, position: 'relative' as const }}>
                        +{memberUserIds.filter((id) => id !== currentUserId).length - 3}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {isEditingName ? (
              <input ref={renameInputRef} type="text" style={styles.renameInput} value={editNameValue} onChange={(e) => setEditNameValue(e.target.value)} onKeyDown={handleRenameKeyDown} onBlur={handleCancelRename} disabled={isRenaming} maxLength={128} aria-label="Rename room" />
            ) : (
              <span className="frame-chat-header-name" style={{ maxWidth: '50vw', cursor: 'pointer' }} onClick={handleStartRename} title="Click to rename">
                {headerName}
              </span>
            )}
            {isAnonymous && !isEditingName && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 10,
                fontWeight: 600,
                color: '#bc8cff',
                backgroundColor: 'rgba(188, 140, 255, 0.1)',
                border: '1px solid rgba(188, 140, 255, 0.25)',
                borderRadius: 4,
                padding: '2px 6px',
                marginLeft: 4,
              }} title="Anonymous mode — identities are hidden">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
                Anonymous
              </span>
            )}
            {roomType === 'direct' && !isEditingName && (
              <span style={styles.verifiedBadge} title="Verified contact">&#10003;</span>
            )}
            {roomType === 'direct' && !isEditingName && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  position: 'relative' as const,
                }}
                onMouseEnter={() => setContactStatusHovered(true)}
                onMouseLeave={() => setContactStatusHovered(false)}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: STATUS_COLORS[contactStatus], // eslint-disable-line security/detect-object-injection
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                  title={STATUS_LABELS[contactStatus]} // eslint-disable-line security/detect-object-injection
                />
                {contactStatusHovered && (
                  <span style={{
                    position: 'absolute' as const,
                    top: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginTop: 4,
                    padding: '3px 8px',
                    fontSize: 11,
                    color: '#c9d1d9',
                    backgroundColor: '#1c2128',
                    border: '1px solid #30363d',
                    borderRadius: 4,
                    whiteSpace: 'nowrap' as const,
                    zIndex: 10,
                    pointerEvents: 'none' as const,
                  }}>
                    {STATUS_LABELS[contactStatus] /* eslint-disable-line security/detect-object-injection */}
                  </span>
                )}
              </span>
            )}
          </div>
          <div style={{ ...styles.headerSubRow, ...(isMobile ? { flexWrap: 'nowrap' as const, overflow: 'hidden', gap: 4 } : {}) }}>
            <span style={styles.encryptionBadge} title="F.R.A.M.E. end-to-end encryption enabled">F.R.A.M.E. E2EE</span>
            {/* Password-protected badge */}
            {roomType === 'group' && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '1px 5px',
                borderRadius: 4,
                backgroundColor: 'rgba(247, 129, 102, 0.1)',
                color: '#f78166',
                fontSize: 10,
                fontWeight: 600,
              }} title="Password protected room">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#f78166" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
              </span>
            )}
            {/* Disappearing messages badge */}
            {disappearingSettings?.enabled && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '1px 5px',
                borderRadius: 4,
                backgroundColor: 'rgba(210, 153, 34, 0.1)',
                color: '#d29922',
                fontSize: 10,
                fontWeight: 600,
              }} title={`Messages auto-delete after ${disappearingSettings.timeoutSeconds < 60 ? String(disappearingSettings.timeoutSeconds) + 's' : disappearingSettings.timeoutSeconds < 3600 ? String(Math.floor(disappearingSettings.timeoutSeconds / 60)) + 'm' : String(Math.floor(disappearingSettings.timeoutSeconds / 3600)) + 'h'}`}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#d29922" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                {disappearingSettings.timeoutSeconds < 60 ? String(disappearingSettings.timeoutSeconds) + 's' : disappearingSettings.timeoutSeconds < 3600 ? String(Math.floor(disappearingSettings.timeoutSeconds / 60)) + 'm' : String(Math.floor(disappearingSettings.timeoutSeconds / 3600)) + 'h'}
              </span>
            )}
            {isSyncing && <SyncIndicator />}
            {memberCount != null && memberCount > 0 && (
              <span style={styles.headerMemberCount}>
                {memberCount} member{memberCount !== 1 ? 's' : ''}
              </span>
            )}
            {roomType === 'direct' && contactStatus !== 'offline' && (
              <span style={{ fontSize: 11, color: '#8b949e' }}>
                {/* eslint-disable-next-line security/detect-object-injection */}
                {'\u00B7'} {STATUS_LABELS[contactStatus]}
              </span>
            )}
            {roomType === 'direct' && contactStatus === 'offline' && (
              <span style={{ fontSize: 11, color: '#6e7681' }}>
                {'\u00B7'} Offline
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 6, position: 'relative' as const }}>
          {/* ── Feature: Search within chat ── */}
          <button type="button" style={styles.searchButton} title="Search in chat" aria-label="Search in chat" onClick={() => { setShowSearch((v) => { if (!v) setTimeout(() => searchInputRef.current?.focus(), 0); return !v; }); if (showSearch) setSearchQuery(''); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={showSearch ? '#58a6ff' : '#8b949e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          </button>
          {!isMobile && <button type="button" style={{ ...styles.disappearingButton, ...(disappearingSettings?.enabled ? styles.disappearingButtonActive : {}) }} title="Disappearing messages" onClick={() => setShowDisappearingMenu(!showDisappearingMenu)}>
            {disappearingSettings?.enabled ? 'Auto-delete ON' : 'Auto-delete'}
          </button>}
          {showDisappearingMenu && (
            <div style={styles.disappearingMenu}>
              <div style={styles.disappearingMenuTitle}>Disappearing Messages</div>
              {[{ label: 'Off', seconds: 0 }, { label: '30 seconds', seconds: 30 }, { label: '5 minutes', seconds: 300 }, { label: '1 hour', seconds: 3600 }, { label: '24 hours', seconds: 86400 }].map((opt) => (
                <button key={opt.seconds} type="button" style={{ ...styles.disappearingMenuItem, ...(disappearingSettings?.enabled && disappearingSettings.timeoutSeconds === opt.seconds ? { color: '#58a6ff' } : {}), ...(!disappearingSettings?.enabled && opt.seconds === 0 ? { color: '#58a6ff' } : {}) }} onClick={() => { void (async () => { try { const { updateRoomSettings } = await import('../api/roomsAPI'); const newSettings = opt.seconds === 0 ? { disappearingMessages: { enabled: false, timeoutSeconds: 0 } } : { disappearingMessages: { enabled: true, timeoutSeconds: opt.seconds } }; await updateRoomSettings(roomId, newSettings); setDisappearingSettings(opt.seconds === 0 ? null : { enabled: true, timeoutSeconds: opt.seconds }); } catch (err) { console.error('Failed to update disappearing settings:', err); } setShowDisappearingMenu(false); })(); }}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {!isMobile && onLeave && (
            <button type="button" style={styles.leaveButton} title="Leave conversation" onClick={onLeave}>Leave</button>
          )}
          {isMobile && (
            <button type="button" style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #30363d', backgroundColor: 'transparent', color: '#8b949e', fontSize: 18, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', flexShrink: 0, minWidth: 44, minHeight: 44 }} title="More options" onClick={() => setShowMobileMoreMenu(!showMobileMoreMenu)} aria-label="More options">
              &#8943;
            </button>
          )}
          {!isMobile && (
            <button type="button" style={styles.infoButton} title="Room info" aria-label="Room info" onClick={() => onOpenSettings?.()}>i</button>
          )}
        </div>
      </div>

      {/* ── Feature: Search bar — full-width on mobile (item 13) ── */}
      {showSearch && (
        <div style={{ ...styles.searchBar, ...(isMobile ? { position: 'relative' as const, zIndex: 50, padding: '8px 10px' } : {}) }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            ref={searchInputRef}
            type="text"
            style={{ ...styles.searchInput, ...(isMobile ? { fontSize: 16, padding: '8px 8px' } : {}) }}
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); } }}
            aria-label="Search messages"
          />
          {searchQuery && (
            <span style={{ fontSize: 11, color: '#8b949e', flexShrink: 0 }}>
              {filteredMessages.length} result{filteredMessages.length !== 1 ? 's' : ''}
            </span>
          )}
          <button type="button" style={{ ...styles.searchCloseButton, ...(isMobile ? { minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}) }} onClick={() => { setShowSearch(false); setSearchQuery(''); }} aria-label="Close search">
            &#10005;
          </button>
        </div>
      )}

      {/* ── Feature: Pinned message bar ── */}
      {pinnedEventIds.length > 0 && showPinnedBar && !showSearch && (() => {
        const latestPinnedId = pinnedEventIds[pinnedEventIds.length - 1];
        const pinnedMsg = messages.find((m) => m.event.eventId === latestPinnedId);
        if (!pinnedMsg) return null;
        const pinnedBody = pinnedMsg.plaintext && typeof pinnedMsg.plaintext.body === 'string'
          ? pinnedMsg.plaintext.body
          : 'Pinned message';
        return (
          <div style={styles.pinnedBar} onClick={() => scrollToMessage(latestPinnedId)}>
            <div style={styles.pinnedBarLeft}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d29922" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <line x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V17z" />
              </svg>
              <div style={{ overflow: 'hidden', flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#d29922', marginBottom: 1 }}>Pinned</div>
                <div style={{ fontSize: 12, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                  {DOMPurify.sanitize(pinnedBody.length > 80 ? pinnedBody.slice(0, 80) + '...' : pinnedBody, PURIFY_CONFIG)}
                </div>
              </div>
            </div>
            <button type="button" style={styles.pinnedBarClose} onClick={(e) => { e.stopPropagation(); setShowPinnedBar(false); }} aria-label="Dismiss pinned message">
              &#10005;
            </button>
          </div>
        );
      })()}

      {syncError && (
        <div style={styles.syncErrorIndicator}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, animation: 'frame-spin 1.5s linear infinite' }}>
            <circle cx="7" cy="7" r="5.5" stroke="#d29922" strokeWidth="1.2" strokeDasharray="20 12" fill="none" />
          </svg>
          <span style={{ fontSize: 11, color: '#d29922' }}>Reconnecting...</span>
        </div>
      )}

      <div ref={messageListRef} style={{ ...styles.messageList, position: 'relative' as const }} onScroll={handleScroll}>
        {/* Subtle F.R.A.M.E. watermark */}
        <div style={{ position: 'fixed' as const, bottom: 80, right: 24, pointerEvents: 'none' as const, opacity: 0.03, zIndex: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="20" height="20" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke="#58a6ff" strokeWidth="4" fill="rgba(88,166,255,0.15)" />
            <path d="M26 32l4 4 8-8" stroke="#3fb950" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9', letterSpacing: 1.5 }}>F.R.A.M.E.</span>
        </div>
        {showRoomSkeleton ? (
          <div style={{ display: 'flex', flexDirection: 'column', padding: '16px 12px', gap: 4 }}>
            <SkeletonMessageBubble align="left" widthPercent={55} />
            <SkeletonMessageBubble align="right" widthPercent={45} />
            <SkeletonMessageBubble align="left" widthPercent={50} />
          </div>
        ) : (
          <>
        {renderWelcome()}
        {renderedMessages}
        {optimisticMessages.map((om) => (
          <div key={om.id} style={{ ...styles.messageBubble, ...(isMobile ? { maxWidth: '85%', padding: '10px 14px', fontSize: 'clamp(14px, 3.8vw, 16px)' } : { maxWidth: 'clamp(200px, 75%, 600px)' }), ...styles.ownMessage, ...(om.status === 'sending' ? styles.optimisticSending : {}), ...(om.status === 'failed' ? styles.optimisticFailed : {}), alignSelf: 'flex-end' as const, ...(recentlySentIds.has(om.id) ? { animation: 'frame-msg-slide-up 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' } : {}) }}>
            <div style={styles.messageBody}>
              <span>{DOMPurify.sanitize(om.body, PURIFY_CONFIG)}</span>
            </div>
            <div style={styles.timestampRow}>
              <span style={styles.timestamp}>{formatRelativeTime(new Date(om.timestamp))}</span>
              {renderSendStatus(om.status)}
              {om.status === 'failed' && (
                <button type="button" style={styles.retryInlineButton} onClick={() => handleRetry(om)} title="Retry sending">Retry</button>
              )}
            </div>
          </div>
        ))}
        {typingUsers.length > 0 && (
          <div className={isMobile ? 'frame-typing-compact' : ''} style={{ ...styles.typingIndicator, display: 'flex', ...(isMobile ? { padding: '2px 6px', minHeight: 16 } : {}) }} aria-label="Typing indicator">
            <div style={{ ...styles.typingDot, ...(isMobile ? { width: 5, height: 5 } : {}) }} />
            <div style={{ ...styles.typingDot, animationDelay: '0.2s', ...(isMobile ? { width: 5, height: 5 } : {}) }} />
            <div style={{ ...styles.typingDot, animationDelay: '0.4s', ...(isMobile ? { width: 5, height: 5 } : {}) }} />
            <span style={{ fontSize: isMobile ? 10 : 11, color: '#8b949e', marginLeft: 4 }}>
              {isMobile
                ? `${typingUsers.map((u) => formatDisplayName(u)).join(', ')} typing...`
                : `${typingUsers.map((u) => formatDisplayName(u)).join(', ')} ${typingUsers.length === 1 ? 'is' : 'are'} typing...`
              }
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {showNewMessagesPill && (
        <button type="button" className="frame-new-messages-pill" style={{ ...styles.newMessagesPill, ...(isMobile ? { bottom: 70 } : {}) }} onClick={scrollToBottom}>New messages</button>
      )}

      {/* Reply preview bar — compact on mobile (item 11) */}
      {replyTo && (
        <div className={isMobile ? 'frame-reply-preview-mobile' : ''} style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 8, padding: isMobile ? '4px 10px' : '6px 12px', borderTop: '1px solid #30363d', backgroundColor: '#1c2128' }}>
          <div style={{ flex: 1, borderLeft: `3px solid ${isAnonymous ? '#bc8cff' : getAvatarColor(replyTo.senderId)}`, paddingLeft: 8, overflow: 'hidden' }}>
            <div style={{ fontSize: isMobile ? 10 : 11, fontWeight: 600, color: isAnonymous ? '#bc8cff' : getAvatarColor(replyTo.senderId), marginBottom: 1 }}>
              {DOMPurify.sanitize(isAnonymous ? 'Anonymous' : formatDisplayName(replyTo.senderId), PURIFY_CONFIG)}
            </div>
            <div className="frame-reply-body" style={{ fontSize: isMobile ? 11 : 12, color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: isMobile ? 'calc(100vw - 80px)' : undefined }}>
              {DOMPurify.sanitize(replyTo.body.length > (isMobile ? 60 : 100) ? replyTo.body.slice(0, isMobile ? 60 : 100) + '...' : replyTo.body, PURIFY_CONFIG)}
            </div>
          </div>
          <button type="button" onClick={handleCancelReply} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 16, cursor: 'pointer', padding: '2px 6px', borderRadius: 4, lineHeight: 1, fontFamily: 'inherit', flexShrink: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Cancel reply" aria-label="Cancel reply">
            &#10005;
          </button>
        </div>
      )}

      {/* Input area — unified bar with all controls inside */}
      <div className="frame-chat-input-area" style={{ borderTop: replyTo ? 'none' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', flex: 1, backgroundColor: '#0d1117', borderRadius: 24, border: isTextareaFocused ? '1px solid #58a6ff' : '1px solid #30363d', transition: 'border-color 0.2s', padding: '4px 4px 4px 8px', gap: 2, position: 'relative' as const, ...(isTextareaFocused ? { animation: 'frame-textarea-glow 2s ease-in-out infinite' } : {}) }}>
          {/* Attachment placeholder */}
          <button type="button" title="File sharing coming soon" aria-label="Attach file (coming soon)" style={{ background: 'none', border: 'none', cursor: 'default', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.35, flexShrink: 0, alignSelf: 'flex-end', marginBottom: 2 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.49" /></svg>
          </button>
          {/* View-once toggle with pill badge — compact on mobile */}
          <button type="button" onClick={() => setViewOnceMode((v) => !v)} title={viewOnceMode ? 'View-once enabled' : 'Enable view-once mode'} aria-label="Toggle view-once mode" style={{ background: viewOnceMode ? 'rgba(217,158,36,0.2)' : 'none', border: 'none', cursor: 'pointer', padding: viewOnceMode ? (isMobile ? '2px 6px 2px 4px' : '3px 10px 3px 6px') : (isMobile ? '4px' : '6px'), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 2 : 4, flexShrink: 0, alignSelf: 'flex-end', marginBottom: 2, borderRadius: 12, transition: 'background-color 0.15s, padding 0.15s' }}>
            <svg width={isMobile ? '14' : '16'} height={isMobile ? '14' : '16'} viewBox="0 0 24 24" fill="none" stroke={viewOnceMode ? '#d99e24' : '#8b949e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            {viewOnceMode && !isMobile && <span style={{ fontSize: 10, fontWeight: 700, color: '#d99e24', letterSpacing: 0.3, whiteSpace: 'nowrap' as const }}>View Once</span>}
          </button>
          {/* Textarea */}
          {/* eslint-disable-next-line security/detect-object-injection */}
          <textarea ref={textareaRef} className="frame-chat-textarea" value={inputValue} onChange={handleTextareaChange} onKeyDown={handleKeyDown} onFocus={() => setIsTextareaFocused(true)} onBlur={() => setIsTextareaFocused(false)} placeholder={viewOnceMode ? 'View-once message...' : INPUT_PLACEHOLDERS[placeholderIndex]} disabled={isSending} autoFocus aria-label="Message input" rows={1} />
          {/* Character count indicator */}
          {inputValue.length > 500 && (
            <span style={{ position: 'absolute' as const, bottom: 6, right: inputValue.trim() ? 88 : 44, fontSize: 10, color: inputValue.length > 4500 ? '#f85149' : '#8b949e', fontFamily: 'inherit', pointerEvents: 'none' as const, transition: 'color 0.2s' }} aria-live="polite">{inputValue.length}/5000</span>
          )}
          {/* Emoji picker — bottom sheet on mobile, popover on desktop */}
          <div ref={emojiPickerRef} style={{ position: 'relative' as const, flexShrink: 0, alignSelf: 'flex-end', marginBottom: 2 }}>
            <button type="button" onClick={() => { if (isMobile) { setShowMobileEmojiSheet((v) => !v); } else { setShowEmojiPicker((v) => !v); } }} title="Insert emoji" aria-label="Emoji picker" style={{ background: (showEmojiPicker || showMobileEmojiSheet) ? 'rgba(88,166,255,0.15)' : 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, transition: 'background-color 0.15s' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={(showEmojiPicker || showMobileEmojiSheet) ? '#58a6ff' : '#8b949e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
            </button>
            {!isMobile && showEmojiPicker && (
              <div style={{ position: 'absolute' as const, bottom: 40, right: 0, backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 12, padding: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.45)', zIndex: 1000, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 2, width: 228 }}>
                {CHAT_EMOJIS.map((em) => (
                  <button key={em} type="button" onClick={() => insertEmojiAtCursor(em)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', padding: 4, borderRadius: 6, lineHeight: 1.2, transition: 'background-color 0.1s' }} onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(88,166,255,0.15)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}>{em}</button>
                ))}
              </div>
            )}
          </div>
          {/* Send button — only when text exists. 44px min touch target on mobile */}
          {inputValue.trim() && (
            <button style={{ padding: isMobile ? '10px 12px' : '6px 14px', borderRadius: 18, border: 'none', backgroundColor: '#58a6ff', color: '#fff', fontSize: 13, fontWeight: 600, cursor: isSending ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background-color 0.15s, opacity 0.15s', alignSelf: 'flex-end', flexShrink: 0, marginBottom: 2, opacity: isSending ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: isMobile ? 44 : undefined, minHeight: isMobile ? 44 : undefined, ...(sendButtonAnimating ? { animation: 'frame-send-launch 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' } : {}) }} onClick={() => void handleSend()} disabled={isSending} aria-label="Send message">
              {isMobile ? (isSending ? (<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="14 14" /></svg>) : (<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>)) : (isSending ? 'Sending...' : 'Send')}
            </button>
          )}
        </div>
      </div>

      {/* Context menu: bottom sheet on mobile, fixed dropdown on desktop */}
      {contextMenuEventId && contextMenuPos && (
        isMobile ? (
          <>
            <div style={{ position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9998, animation: 'frame-overlay-fade-in 0.2s ease-out' }} onClick={() => { setContextMenuEventId(null); setContextMenuPos(null); }} />
            <div style={{ position: 'fixed' as const, bottom: 0, left: 0, right: 0, backgroundColor: '#21262d', borderTop: '1px solid #30363d', borderRadius: '16px 16px 0 0', padding: '8px 0', paddingBottom: 'env(safe-area-inset-bottom, 8px)', zIndex: 9999, animation: 'frame-bottom-sheet-slide-up 0.25s cubic-bezier(0.32, 0.72, 0, 1)', boxShadow: '0 -4px 24px rgba(0,0,0,0.4)' }}>
              <div style={{ width: 36, height: 4, backgroundColor: '#484f58', borderRadius: 2, margin: '4px auto 12px' }} />
              <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: '#c9d1d9', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => handleReplyToMessage(contextMenuEventId)}>Reply</button>
              <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: '#c9d1d9', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => void handleForwardMessage(contextMenuEventId)}>Forward</button>
              <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: '#c9d1d9', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => handleCopyText(contextMenuEventId)}>Copy Text</button>
              <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: '#d29922', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => void handleTogglePin(contextMenuEventId)}>
                {pinnedEventIds.includes(contextMenuEventId) ? 'Unpin' : 'Pin'}
              </button>
              {messages.find((m) => m.event.eventId === contextMenuEventId)?.event.senderId === currentUserId && (
                <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: '#f85149', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => void handleDeleteMessage(contextMenuEventId)}>Delete</button>
              )}
            </div>
          </>
        ) : (
          <div style={{ ...styles.contextMenu, top: contextMenuPos.y, left: contextMenuPos.x }}>
            <button type="button" className="frame-context-menu-item" style={{ ...styles.contextMenuItem, color: '#c9d1d9' }} onClick={() => handleReplyToMessage(contextMenuEventId)}>Reply</button>
            <button type="button" className="frame-context-menu-item" style={{ ...styles.contextMenuItem, color: '#c9d1d9' }} onClick={() => void handleForwardMessage(contextMenuEventId)}>Forward</button>
            <button type="button" className="frame-context-menu-item" style={{ ...styles.contextMenuItem, color: '#c9d1d9' }} onClick={() => handleCopyText(contextMenuEventId)}>Copy Text</button>
            <button type="button" className="frame-context-menu-item" style={{ ...styles.contextMenuItem, color: '#d29922' }} onClick={() => void handleTogglePin(contextMenuEventId)}>
              {pinnedEventIds.includes(contextMenuEventId) ? 'Unpin' : 'Pin'}
            </button>
            {messages.find((m) => m.event.eventId === contextMenuEventId)?.event.senderId === currentUserId && (
              <button type="button" className="frame-context-menu-item" style={styles.contextMenuItem} onClick={() => void handleDeleteMessage(contextMenuEventId)}>Delete</button>
            )}
          </div>
        )
      )}

      {/* Forward room picker dialog */}
      {showForwardDialog && (
        <div style={styles.forwardOverlay} onClick={() => { setShowForwardDialog(false); setForwardEventId(null); }}>
          <div style={styles.forwardDialog} onClick={(e) => e.stopPropagation()}>
            <div style={styles.forwardTitle}>Forward to...</div>
            <div style={styles.forwardList}>
              {forwardRooms.length === 0 ? (
                <div style={{ padding: 16, color: '#8b949e', textAlign: 'center' as const, fontSize: 13 }}>No other rooms available</div>
              ) : (
                forwardRooms.map((r) => {
                  const name = r.name || r.members.map((m) => formatDisplayName(m.userId)).join(', ') || r.roomId;
                  return (
                    <button key={r.roomId} type="button" style={styles.forwardRoomItem} onClick={() => void handleForwardToRoom(r.roomId, name)}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1c2128'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: getAvatarColor(r.roomId), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontSize: 13, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{DOMPurify.sanitize(name, PURIFY_CONFIG)}</span>
                    </button>
                  );
                })
              )}
            </div>
            <button type="button" style={styles.forwardCancel} onClick={() => { setShowForwardDialog(false); setForwardEventId(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {reactionPickerEventId && reactionPickerPos && (
        <div style={{ ...styles.reactionPicker, top: reactionPickerPos.y, left: reactionPickerPos.x }} onClick={(e) => e.stopPropagation()}>
          {QUICK_REACTIONS.map((emoji) => (
            <button key={emoji} type="button" style={styles.reactionPickerEmoji} onClick={() => void handleReact(reactionPickerEventId, emoji)}>{emoji}</button>
          ))}
        </div>
      )}

      {/* ── Mobile "more" bottom sheet (item 4) ── */}
      {isMobile && showMobileMoreMenu && (
        <>
          <div style={{ position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9998, animation: 'frame-overlay-fade-in 0.2s ease-out' }} onClick={() => setShowMobileMoreMenu(false)} />
          <div style={{ position: 'fixed' as const, bottom: 0, left: 0, right: 0, backgroundColor: '#21262d', borderTop: '1px solid #30363d', borderRadius: '16px 16px 0 0', padding: '8px 0', paddingBottom: 'env(safe-area-inset-bottom, 8px)', zIndex: 9999, animation: 'frame-bottom-sheet-slide-up 0.25s cubic-bezier(0.32, 0.72, 0, 1)', boxShadow: '0 -4px 24px rgba(0,0,0,0.4)' }}>
            <div style={{ width: 36, height: 4, backgroundColor: '#484f58', borderRadius: 2, margin: '4px auto 12px' }} />
            <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: disappearingSettings?.enabled ? '#d29922' : '#c9d1d9', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => { setShowMobileMoreMenu(false); setShowDisappearingMenu(!showDisappearingMenu); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={disappearingSettings?.enabled ? '#d29922' : '#8b949e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              {disappearingSettings?.enabled ? 'Auto-delete ON' : 'Auto-delete'}
            </button>
            <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: '#c9d1d9', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => { setShowMobileMoreMenu(false); onOpenSettings?.(); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
              Room Info
            </button>
            {onLeave && (
              <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: '#f85149', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => { setShowMobileMoreMenu(false); onLeave(); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f85149" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                Leave Conversation
              </button>
            )}
          </div>
        </>
      )}

      {/* ── Mobile emoji bottom sheet (item 6) ── */}
      {isMobile && showMobileEmojiSheet && (
        <>
          <div style={{ position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9998, animation: 'frame-overlay-fade-in 0.2s ease-out' }} onClick={() => setShowMobileEmojiSheet(false)} />
          <div style={{ position: 'fixed' as const, bottom: 0, left: 0, right: 0, backgroundColor: '#21262d', borderTop: '1px solid #30363d', borderRadius: '16px 16px 0 0', padding: '8px 12px', paddingBottom: 'env(safe-area-inset-bottom, 12px)', zIndex: 9999, animation: 'frame-bottom-sheet-slide-up 0.25s cubic-bezier(0.32, 0.72, 0, 1)', maxHeight: '45vh' }}>
            <div style={{ width: 36, height: 4, backgroundColor: '#484f58', borderRadius: 2, margin: '4px auto 8px' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: '#8b949e', padding: '4px 4px 8px', textAlign: 'center' as const }}>Emoji</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, padding: '8px 0' }}>
              {CHAT_EMOJIS.map((em) => (
                <button key={em} type="button" onClick={() => { insertEmojiAtCursor(em); setShowMobileEmojiSheet(false); }} style={{ background: 'none', border: 'none', fontSize: 26, cursor: 'pointer', padding: 8, borderRadius: 10, lineHeight: 1.2, minHeight: 48, minWidth: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{em}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ── Inline styles ──

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', fontFamily: FONT_BODY, border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden', backgroundColor: '#0d1117', position: 'relative' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', borderBottom: '1px solid #30363d', backgroundColor: '#161b22' },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  headerNameRow: { display: 'flex', alignItems: 'center', gap: 6 },
  headerName: { fontSize: 'clamp(12px, 1.3vw, 15px)', fontWeight: 600, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  verifiedBadge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', backgroundColor: 'rgba(35, 134, 54, 0.2)', color: '#3fb950', fontSize: 10, fontWeight: 700, flexShrink: 0 },
  headerSubRow: { display: 'flex', alignItems: 'center', gap: 8 },
  headerMemberCount: { fontSize: 12, color: '#8b949e' },
  infoButton: { width: 28, height: 28, borderRadius: '50%', border: '1px solid #30363d', backgroundColor: 'transparent', color: '#c9d1d9', fontSize: 14, fontWeight: 600, fontStyle: 'italic', fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'border-color 0.15s, color 0.15s' },
  renameInput: { fontSize: 15, fontWeight: 600, color: '#e6edf3', backgroundColor: '#0d1117', border: '1px solid #58a6ff', borderRadius: 4, padding: '2px 6px', fontFamily: 'inherit', outline: 'none', width: '100%', maxWidth: 240 },
  encryptionBadge: { fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4, backgroundColor: 'rgba(35, 134, 54, 0.15)', color: '#3fb950' },
  roomLabel: { fontSize: 13, color: '#c9d1d9' },
  syncErrorIndicator: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 14px', backgroundColor: 'rgba(210, 153, 34, 0.08)', borderBottom: '1px solid rgba(210, 153, 34, 0.15)' },
  messageList: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 2, scrollBehavior: 'smooth' as const, WebkitOverflowScrolling: 'touch' as const },
  dateSeparator: { display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0 8px' },
  dateSeparatorLine: { flex: 1, height: 1, backgroundColor: '#21262d' },
  dateSeparatorText: { fontSize: 11, fontWeight: 600, color: '#8b949e', textTransform: 'uppercase' as const, letterSpacing: '0.05em', flexShrink: 0 },
  timeGap: { display: 'flex', justifyContent: 'center', margin: '8px 0 4px' },
  timeGapText: { fontSize: 10, color: '#8b949e', backgroundColor: '#161b22', padding: '2px 10px', borderRadius: 10 },
  emptyState: { textAlign: 'center', color: '#8b949e', marginTop: 40, fontSize: 14 },
  messageBubble: { maxWidth: 'clamp(200px, 75%, 600px)', minWidth: 80, padding: '8px 12px', borderRadius: 12, fontSize: 'clamp(13px, 1.4vw, 16px)', lineHeight: 1.4, wordBreak: 'break-word' as const, overflowWrap: 'break-word' as const },
  ownMessage: { backgroundColor: '#58a6ff', color: '#ffffff' },
  otherMessage: { backgroundColor: '#21262d', color: '#c9d1d9' },
  errorMessage: { opacity: 0.7, borderLeft: '3px solid #f85149' },
  previousSessionMessage: { opacity: 0.6, borderLeft: '2px solid #484f58' },
  previousSessionInline: { display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'help' },
  previousSessionText: { fontStyle: 'italic', opacity: 0.85, fontSize: 13, color: '#8b949e' },
  previousSessionLock: { fontSize: 12, flexShrink: 0, marginTop: 0, opacity: 0.5, color: '#8b949e' },
  previousSessionInfoIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%', border: '1px solid #484f58', fontSize: 9, fontWeight: 600, fontStyle: 'italic', color: '#8b949e', cursor: 'help', flexShrink: 0, lineHeight: 1 },
  previousSessionBlock: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 16px', margin: '8px 0', backgroundColor: 'rgba(139, 148, 158, 0.06)', border: '1px solid rgba(139, 148, 158, 0.12)', borderRadius: 10 },
  previousSessionBlockInner: { display: 'flex', alignItems: 'center', gap: 6 },
  previousSessionBlockText: { fontSize: 13, color: '#8b949e', fontStyle: 'italic' },
  previousSessionLearnMore: { fontSize: 10, color: '#6e7681', fontStyle: 'italic' },
  optimisticSending: { opacity: 0.7 },
  optimisticFailed: { opacity: 0.8, backgroundColor: '#4a3040', borderRight: '3px solid #f85149' },
  senderName: { fontSize: 11, fontWeight: 600, marginBottom: 2 },
  messageBody: { display: 'flex', alignItems: 'flex-start', gap: 3, overflowWrap: 'break-word' as const, wordBreak: 'break-word' as const },
  encryptionLock: { fontSize: 10, flexShrink: 0, marginTop: 2, opacity: 0.6, filter: 'drop-shadow(0 0 3px rgba(63,185,80,0.4))', color: '#3fb950' },
  encryptionWarning: { fontSize: 14, color: '#8b949e', flexShrink: 0, marginTop: -1 },
  decryptErrorInline: { display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'help' },
  errorText: { fontStyle: 'italic', opacity: 0.8, fontSize: 13, color: '#8b949e' },
  timestampRow: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 3 },
  timestamp: { fontSize: 10, opacity: 0.55, textAlign: 'right', color: 'inherit', letterSpacing: '0.01em' },
  statusIcon: { fontSize: 10, opacity: 0.6 },
  statusIconSent: { fontSize: 11, color: '#ffffff', opacity: 0.8 },
  statusIconFailed: { fontSize: 12, color: '#f85149' },
  retryInlineButton: { padding: '1px 6px', fontSize: 10, fontWeight: 600, backgroundColor: 'rgba(248, 81, 73, 0.2)', color: '#f85149', border: '1px solid rgba(248, 81, 73, 0.4)', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit', marginLeft: 2 },
  deletedText: { fontStyle: 'italic', color: '#8b949e', opacity: 0.7 },
  contextMenu: { position: 'fixed' as const, zIndex: 9999, backgroundColor: '#1c2128', border: '1px solid rgba(99, 110, 123, 0.35)', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)', padding: 6, minWidth: 140, backdropFilter: 'blur(12px)', animation: 'frame-context-menu-in 0.15s ease-out' },
  contextMenuItem: { display: 'block', width: '100%', padding: '8px 14px', fontSize: 13, color: '#f85149', backgroundColor: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left' as const, fontFamily: 'inherit', transition: 'background-color 0.12s' },
  expiredText: { fontStyle: 'italic', color: '#8b949e', opacity: 0.6 },
  leaveButton: { padding: '4px 10px', fontSize: 11, fontWeight: 600, backgroundColor: 'rgba(248, 81, 73, 0.1)', color: '#f85149', border: '1px solid rgba(248, 81, 73, 0.3)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' },
  disappearingButton: { padding: '4px 8px', fontSize: 10, fontWeight: 600, backgroundColor: 'transparent', color: '#8b949e', border: '1px solid #30363d', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' as const },
  disappearingButtonActive: { backgroundColor: 'rgba(210, 153, 34, 0.15)', color: '#d29922', borderColor: '#d29922' },
  disappearingMenu: { position: 'absolute' as const, top: '100%', right: 0, marginTop: 4, backgroundColor: '#21262d', border: '1px solid #30363d', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: 6, zIndex: 100, minWidth: 160 },
  disappearingMenuTitle: { fontSize: 11, fontWeight: 600, color: '#8b949e', padding: '4px 8px 6px', borderBottom: '1px solid #30363d', marginBottom: 4 },
  disappearingMenuItem: { display: 'block', width: '100%', padding: '6px 8px', fontSize: 12, color: '#c9d1d9', backgroundColor: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', textAlign: 'left' as const, fontFamily: 'inherit' },
  viewOnceIcon: { fontSize: 12, flexShrink: 0, marginTop: 1, opacity: 0.7 },
  newMessagesPill: { position: 'absolute' as const, bottom: 80, left: '50%', transform: 'translateX(-50%)', padding: '6px 16px', fontSize: 12, fontWeight: 600, color: '#ffffff', backgroundColor: '#58a6ff', border: 'none', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 10, transition: 'opacity 0.2s' },
  typingIndicator: { display: 'none', alignItems: 'center', gap: 4, padding: '4px 8px', marginTop: 4, alignSelf: 'flex-start', minHeight: 20 },
  typingDot: { width: 6, height: 6, borderRadius: '50%', backgroundColor: '#484f58', animation: 'frame-typing-bounce 1.4s infinite ease-in-out' },
  welcomeContainer: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center', flex: 1 },
  welcomeIconWrap: { marginBottom: 12, opacity: 0.7 },
  welcomeTitle: { fontSize: 15, fontWeight: 600, color: '#e6edf3', marginBottom: 8, maxWidth: 320, lineHeight: 1.4 },
  welcomeSubtitle: { fontSize: 13, color: '#8b949e', marginBottom: 12 },
  welcomeE2eeBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 12, backgroundColor: 'rgba(35, 134, 54, 0.1)', color: '#3fb950', fontSize: 11, fontWeight: 600 },
  reactionsRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 4, marginTop: 4 },
  reactionBadge: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', fontSize: 12, borderRadius: 10, border: '1px solid #30363d', backgroundColor: 'rgba(33, 38, 45, 0.8)', color: '#c9d1d9', cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color 0.15s, background-color 0.15s', lineHeight: 1.3 },
  reactionBadgeOwn: { borderColor: '#58a6ff', backgroundColor: 'rgba(88, 166, 255, 0.15)' },
  hoverActionButton: { width: 24, height: 24, borderRadius: 6, border: 'none', backgroundColor: 'transparent', color: '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, transition: 'color 0.15s, background-color 0.15s', fontFamily: 'inherit', lineHeight: 1 },
  reactionPicker: { position: 'fixed' as const, zIndex: 9999, display: 'flex', gap: 2, padding: '4px 6px', backgroundColor: '#1c2128', border: '1px solid rgba(99, 110, 123, 0.35)', borderRadius: 20, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', animation: 'frame-context-menu-in 0.15s ease-out' },
  reactionPickerEmoji: { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, backgroundColor: 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer', transition: 'background-color 0.12s, transform 0.12s', fontFamily: 'inherit' },
  readReceiptIcon: { fontSize: 11, color: '#3fb950', opacity: 0.8, marginLeft: 2 },
  forwardOverlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  forwardDialog: { backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 12, width: 320, maxHeight: 420, display: 'flex', flexDirection: 'column' as const, boxShadow: '0 16px 48px rgba(0,0,0,0.5)', animation: 'frame-context-menu-in 0.15s ease-out' },
  forwardTitle: { fontSize: 15, fontWeight: 600, color: '#e6edf3', padding: '16px 16px 12px', borderBottom: '1px solid #30363d' },
  forwardList: { flex: 1, overflowY: 'auto' as const, padding: '4px 0' },
  forwardRoomItem: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' as const, transition: 'background-color 0.12s' },
  forwardCancel: { padding: '10px', fontSize: 13, fontWeight: 600, color: '#8b949e', backgroundColor: 'transparent', border: 'none', borderTop: '1px solid #30363d', cursor: 'pointer', fontFamily: 'inherit', borderRadius: '0 0 12px 12px', transition: 'color 0.12s' },

  // ── Feature: Search within chat ──
  searchButton: { width: 28, height: 28, borderRadius: '50%', border: '1px solid #30363d', backgroundColor: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'border-color 0.15s' },
  searchBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderBottom: '1px solid #30363d', backgroundColor: '#1c2128' },
  searchInput: { flex: 1, padding: '6px 8px', fontSize: 13, color: '#c9d1d9', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: 6, fontFamily: 'inherit', outline: 'none' },
  searchCloseButton: { background: 'none', border: 'none', color: '#8b949e', fontSize: 14, cursor: 'pointer', padding: '2px 6px', borderRadius: 4, lineHeight: 1, fontFamily: 'inherit', flexShrink: 0 },

  // ── Feature: Pinned messages ──
  pinnedBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 14px', borderBottom: '1px solid #30363d', backgroundColor: 'rgba(210, 153, 34, 0.06)', cursor: 'pointer', transition: 'background-color 0.15s' },
  pinnedBarLeft: { display: 'flex', alignItems: 'center', gap: 8, flex: 1, overflow: 'hidden' },
  pinnedBarClose: { background: 'none', border: 'none', color: '#8b949e', fontSize: 12, cursor: 'pointer', padding: '2px 6px', borderRadius: 4, lineHeight: 1, fontFamily: 'inherit', flexShrink: 0 },

  // ── Feature: Unread divider ──
  unreadDivider: { display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0 6px' },
  unreadDividerLine: { flex: 1, height: 1, backgroundColor: '#58a6ff' },
  unreadDividerText: { fontSize: 11, fontWeight: 600, color: '#58a6ff', flexShrink: 0, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
};

export default React.memo(ChatWindow);
