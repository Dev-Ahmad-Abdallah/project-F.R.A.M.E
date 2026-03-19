import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
import { sendMessage, deleteMessage, syncMessages, SyncEvent, reactToMessage, markAsRead, getReadReceipts, ReactionData, setTyping, getTypingUsers } from '../api/messagesAPI';
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
import { playMessageSound, playSendSound, playErrorSound, playDestructSound } from '../sounds';
import { getSendReadReceipts, getSendTypingIndicators } from '../utils/privacyPreferences';
import VoiceRecorder from './VoiceRecorder';
import CameraCapture from './CameraCapture';
import AudioPlayer from './AudioPlayer';
import FileAttachment from './FileAttachment';
import EncryptionVisualizer from './EncryptionVisualizer';
import { generateCodename } from '../utils/codenames';
import { unlockRank } from '../utils/rankSystem';
import { encryptFile } from '../crypto/fileEncryption';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE, FRIENDLY_FILE_TYPES, FILE_ACCEPT_STRING, uploadFile } from '../api/filesAPI';
import { formatFileSize } from '../crypto/fileEncryption';

// ── Reaction Picker ──

const QUICK_REACTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F44F}'];

// ── Cipher Typing Indicator ──
const CIPHER_CHARS = '!@#$%^&*()_+-=[]{}|;:<>?/~0123456789ABCDEFabcdef';

function CipherTypingIndicator({ displayName }: { displayName: string }) {
  const [text, setText] = useState('');
  const [animKey, setAnimKey] = useState(0);
  const target = `${displayName} is typing`;

  // Restart animation when displayName changes
  useEffect(() => {
    setAnimKey((k) => k + 1);
  }, [displayName]);

  useEffect(() => {
    let frame = 0;
    const maxFrames = target.length * 3;
    setText(''); // reset on restart
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

// ── Self-Destruct Countdown Badge ──

function DisappearingCountdownBadge({ msgTimestamp, timeoutSeconds, enabled, isExpired }: {
  msgTimestamp: number;
  timeoutSeconds: number;
  enabled: boolean;
  isExpired: boolean;
}) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
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

// ── DEFCON Threat Level Badge ──

type ThreatLevel = 'secure' | 'caution' | 'alert';

const THREAT_CONFIG: Record<ThreatLevel, { color: string; bg: string; border: string; label: string; sub: string }> = {
  secure: { color: '#3fb950', bg: 'rgba(63,185,80,0.08)', border: '#3fb950', label: 'DEFCON 5', sub: 'SECURE' },
  caution: { color: '#d29922', bg: 'rgba(210,153,34,0.08)', border: '#d29922', label: 'DEFCON 3', sub: 'CAUTION' },
  alert: { color: '#f85149', bg: 'rgba(248,81,73,0.08)', border: '#f85149', label: 'DEFCON 1', sub: 'ALERT' },
};

function ThreatLevelBadge({ level }: { level: ThreatLevel }) {
  const cfg = THREAT_CONFIG[level];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px 3px 8px',
        borderRadius: 999,
        backgroundColor: cfg.bg,
        border: `1.5px solid ${cfg.border}`,
        background: `linear-gradient(${cfg.bg}, ${cfg.bg}) padding-box, linear-gradient(135deg, ${cfg.color}, transparent 60%, ${cfg.color}) border-box`,
        boxShadow: `0 0 8px ${cfg.bg}, inset 0 0 4px ${cfg.bg}`,
        maxWidth: 120,
        cursor: 'default',
        lineHeight: 1,
      }}
      title={`${cfg.label} — ${cfg.sub}: ${level === 'secure' ? 'All devices verified, full E2EE' : level === 'caution' ? 'Encrypted but unverified devices present' : 'Key transparency warning or new unverified device'}`}
    >
      {/* Pulsing dot */}
      <span
        style={{
          display: 'inline-block',
          width: 7,
          height: 7,
          borderRadius: '50%',
          backgroundColor: cfg.color,
          boxShadow: `0 0 6px ${cfg.color}`,
          animation: 'frame-defcon-pulse 2s ease-in-out infinite',
          flexShrink: 0,
        }}
      />
      {/* DEFCON label */}
      <span
        style={{
          fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
          fontSize: 11,
          fontWeight: 700,
          color: cfg.color,
          letterSpacing: '0.12em',
          textTransform: 'uppercase' as const,
          whiteSpace: 'nowrap' as const,
        }}
      >
        {cfg.label}
      </span>
      {/* Separator */}
      <span style={{ color: cfg.color, opacity: 0.4, fontSize: 9 }}>{'\u2014'}</span>
      {/* Sub-label */}
      <span
        style={{
          fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
          fontSize: 9,
          fontWeight: 600,
          color: cfg.color,
          opacity: 0.85,
          letterSpacing: '0.15em',
          textTransform: 'uppercase' as const,
          whiteSpace: 'nowrap' as const,
        }}
      >
        {cfg.sub}
      </span>
    </span>
  );
}

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

// ── URL & Markdown-lite formatting helpers ──

const URL_REGEX = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

/**
 * Sanitize a URL — only allow http/https protocols.
 */
function sanitizeUrl(raw: string): string | null {
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
 * Truncate a display URL: show first 40 chars + "..." for long URLs.
 */
function truncateUrl(url: string): string {
  if (url.length <= 50) return url;
  return url.slice(0, 40) + '\u2026';
}

/**
 * Parse markdown-lite formatting tokens in a text segment into React elements.
 * Supports: ```code blocks```, `inline code`, **bold** / *bold*, __italic__ / _italic_,
 * ~~strikethrough~~ / ~strikethrough~.
 */
function parseMarkdownLite(text: string, isOwn: boolean): React.ReactNode[] {
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
function parseInlineFormatting(text: string, isOwn: boolean): React.ReactNode[] {
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
function linkifyText(text: string, isOwn: boolean): React.ReactNode[] {
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
 * Format full timestamp for tooltip display.
 */
function formatFullTimestamp(date: Date | string): string {
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
  // E2EE handshake animation overlay — plays once per room per session
  const [e2eeAnimDone, setE2eeAnimDone] = useState(false);
  // Reset visualizer state when switching rooms so it can play for new rooms
  useEffect(() => {
    setE2eeAnimDone(false);
  }, [roomId]);
  // Sync activity indicator: true while actively fetching
  const [isSyncing, setIsSyncing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceStream, setVoiceStream] = useState<MediaStream | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [contextMenuEventId, setContextMenuEventId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [deletedEventIds, setDeletedEventIds] = useState<Set<string>>(new Set());
  const [viewOnceMode, setViewOnceMode] = useState(false);
  const [viewedOnceIds, setViewedOnceIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('frame-viewed-once');
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const [hiddenOnceIds, setHiddenOnceIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('frame-hidden-once');
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const [_consumedOnceIds, setConsumedOnceIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('frame-consumed-once');
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const [expiredEventIds, setExpiredEventIds] = useState<Set<string>>(new Set());
  const [selfDestructingIds, setSelfDestructingIds] = useState<Set<string>>(new Set());
  const [destroyedIds, setDestroyedIds] = useState<Set<string>>(new Set());
  const [showDestructFlash, setShowDestructFlash] = useState(false);
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

  // Read receipts map: eventId -> { readAt }
  const [readReceiptMap, setReadReceiptMap] = useState<Record<string, { readAt: string }>>({});

  // Message forwarding state
  const [forwardEventId, setForwardEventId] = useState<string | null>(null);
  const [forwardRooms, setForwardRooms] = useState<RoomSummary[]>([]);
  const [showForwardDialog, setShowForwardDialog] = useState(false);

  // ── Feature: Search within chat ──
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
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

  // ── Feature: File attachment ──
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pending file preview (selected via picker, paste, or drag-drop)
  const [pendingFile, setPendingFile] = useState<{
    file: File;
    previewUrl: string | null; // object URL for image thumbnails
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

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

  // ── Keyboard shortcut: Ctrl+F / Cmd+F opens search ──
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setSearchMatchIndex(0);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
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
        @keyframes frame-cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
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
        @media (hover: none), (max-width: 600px) {
          .frame-msg-hover-actions {
            display: none !important;
          }
        }
        .frame-reaction-emoji:hover {
          background-color: rgba(88, 166, 255, 0.15) !important;
          transform: scale(1.2) !important;
        }
        .frame-reaction-badge:hover {
          border-color: #58a6ff !important;
        }
        .frame-msg-text-own a:hover, .frame-msg-text a:hover {
          opacity: 0.8 !important;
        }
        .frame-msg-text-own a {
          color: rgba(255,255,255,0.95) !important;
          text-decoration: underline !important;
        }
        .frame-msg-text a {
          color: #58a6ff !important;
          text-decoration: underline !important;
        }
        @keyframes frame-bottom-sheet-slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes frame-overlay-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes frame-defcon-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Fetch read receipts for the room
  useEffect(() => {
    let cancelled = false;
    const fetchReceipts = async () => {
      try {
        const { receipts } = await getReadReceipts(roomId);
        if (!cancelled && receipts && receipts.length > 0) {
          const map: Record<string, { readAt: string }> = {};
          for (const r of receipts) {
            map[r.event_id] = { readAt: r.read_at };
          }
          setReadReceiptMap(map);
        }
      } catch {
        // Read receipts are non-critical — silently ignore errors
      }
    };
    void fetchReceipts();
    // Refresh receipts periodically
    const interval = setInterval(() => { void fetchReceipts(); }, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [roomId]);

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

  // Expire messages client-side — with self-destruct burn animation
  useEffect(() => {
    if (!disappearingSettings?.enabled) return;
    const checkExpired = () => {
      const now = Date.now();
      const timeoutMs = disappearingSettings.timeoutSeconds * 1000;
      const newExpired = new Set(expiredEventIds);
      const newDestructing = new Set(selfDestructingIds);
      let changed = false;
      let destructChanged = false;
      for (const msg of messages) {
        const msgTime = new Date(msg.event.originServerTs).getTime();
        if (now - msgTime > timeoutMs && !newExpired.has(msg.event.eventId) && !newDestructing.has(msg.event.eventId)) {
          // Start self-destruct animation instead of instant expire
          newDestructing.add(msg.event.eventId);
          destructChanged = true;
          playDestructSound();
          // After animation completes (0.8s), mark as fully expired and show destroyed text
          setTimeout(() => {
            setShowDestructFlash(true);
            setTimeout(() => setShowDestructFlash(false), 100);
            setSelfDestructingIds((prev) => {
              const next = new Set(prev);
              next.delete(msg.event.eventId);
              return next;
            });
            setDestroyedIds((prev) => new Set(prev).add(msg.event.eventId));
            // After showing "MESSAGE DESTROYED" for 2s, mark as expired (fully hidden)
            setTimeout(() => {
              setDestroyedIds((prev) => {
                const next = new Set(prev);
                next.delete(msg.event.eventId);
                return next;
              });
              setExpiredEventIds((prev) => new Set(prev).add(msg.event.eventId));
            }, 2000);
          }, 800);
        }
      }
      if (destructChanged) setSelfDestructingIds(newDestructing);
      // Also check for messages already past timeout on initial load
      for (const msg of messages) {
        const msgTime = new Date(msg.event.originServerTs).getTime();
        if (now - msgTime > timeoutMs + 3000 && !newExpired.has(msg.event.eventId)) {
          newExpired.add(msg.event.eventId);
          changed = true;
        }
      }
      if (changed) setExpiredEventIds(newExpired);
    };
    checkExpired();
    const disappearTimer = setInterval(checkExpired, 1000);
    return () => clearInterval(disappearTimer);
  }, [disappearingSettings, messages, expiredEventIds, selfDestructingIds]);

  // View-once timer refs — keyed by eventId so we can clean up on unmount
  const viewOnceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Clean up all view-once timers on unmount
  useEffect(() => {
    return () => {
      for (const t of Object.values(viewOnceTimersRef.current)) clearTimeout(t);
    };
  }, []);

  /** Get the display type label for a view-once message */
  const getViewOnceType = useCallback((plaintext: Record<string, unknown>): string => {
    const msgtype = plaintext?.msgtype as string;
    if (msgtype === 'm.audio') return '\uD83C\uDFA4 Voice message';
    if (msgtype === 'm.image') return '\uD83D\uDCF7 Photo';
    if (msgtype === 'm.file') return `\uD83D\uDCCE ${(plaintext.filename as string) || 'File'}`;
    return '\uD83D\uDCAC Message';
  }, []);

  /** Get auto-hide duration for view-once message types */
  const getViewOnceDuration = useCallback((plaintext: Record<string, unknown>): number => {
    const msgtype = plaintext?.msgtype as string;
    if (msgtype === 'm.audio') {
      // Audio: playback duration + 3 seconds buffer, min 10s
      const dur = (plaintext.duration as number) || 5000;
      return dur + 3000;
    }
    if (msgtype === 'm.image') return 30000; // Images: 30 seconds
    if (msgtype === 'm.file') return 10000;  // Files: 10 seconds to download
    return 5000; // Text: 5 seconds
  }, []);

  /** Reveal a view-once message: mark as viewed, start auto-hide timer */
  const revealViewOnce = useCallback((eventId: string, plaintext: Record<string, unknown>) => {
    // Mark as viewed
    setViewedOnceIds((prev) => {
      const next = new Set(prev);
      next.add(eventId);
      try { localStorage.setItem('frame-viewed-once', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });

    // Start auto-hide timer based on content type
    const duration = getViewOnceDuration(plaintext);
    const timer = setTimeout(() => {
      setHiddenOnceIds((prev) => {
        const next = new Set(prev);
        next.add(eventId);
        try { localStorage.setItem('frame-hidden-once', JSON.stringify([...next])); } catch { /* ignore */ }
        return next;
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.event.eventId === eventId
            ? { ...m, plaintext: null, decryptionError: 'View-once message already viewed' }
            : m,
        ),
      );
      // Fire-and-forget server deletion
      deleteMessage(eventId).catch((err) =>
        console.error('[ViewOnce] Failed to delete from server:', err),
      );
      delete viewOnceTimersRef.current[eventId];
    }, duration);
    viewOnceTimersRef.current[eventId] = timer;
  }, [getViewOnceDuration]);

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
    const el = messageRefs.current[eventId];
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

      await sendMessage(roomId, 'm.room.encrypted', encryptedContent);

      playSendSound();
      unlockRank('recruit');
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

  const handleVoiceSend = useCallback(async (audioBase64: string, durationMs: number, mimeType?: string) => {
    setIsRecordingVoice(false);
    if (!roomId) return;
    try {
      const voiceContent: Record<string, unknown> = {
        msgtype: 'm.audio',
        body: 'Voice message',
        audioData: audioBase64,
        duration: durationMs,
      };
      // Include the actual MIME type so receivers (especially Safari) can play it back correctly
      if (mimeType) {
        voiceContent.audioMimeType = mimeType;
      }
      if (viewOnceMode) {
        voiceContent.viewOnce = true;
      }
      const encrypted = await encryptForRoom(roomId, 'm.room.message', voiceContent, memberUserIds);
      await sendMessage(roomId, 'm.room.encrypted', encrypted);
      playSendSound();
    } catch (err) {
      console.error('[VoiceSend] Failed:', err);
      playErrorSound();
      showToast?.('error', 'Failed to send voice message. Please try again.', { duration: 4000, dedupeKey: 'voice-fail' });
    }
  }, [roomId, memberUserIds, showToast]);

  // ── File attachment: staging ──

  /** Validate and stage a file for preview before sending */
  const stageFile = useCallback((file: File) => {
    // Validate file type
    if (!ALLOWED_FILE_TYPES.has(file.type)) {
      showToast?.('error', `File type not allowed. Supported: ${FRIENDLY_FILE_TYPES}`, { duration: 5000 });
      return;
    }
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      showToast?.('error', 'File too large. Maximum 10 MB.', { duration: 4000 });
      return;
    }
    // Create preview URL for images
    const isImage = file.type.startsWith('image/');
    const previewUrl = isImage ? URL.createObjectURL(file) : null;

    // Revoke previous preview URL if any
    if (pendingFile?.previewUrl) {
      URL.revokeObjectURL(pendingFile.previewUrl);
    }

    setPendingFile({ file, previewUrl });
  }, [showToast, pendingFile]);

  /** Cancel pending file */
  const cancelPendingFile = useCallback(() => {
    if (pendingFile?.previewUrl) {
      URL.revokeObjectURL(pendingFile.previewUrl);
    }
    setPendingFile(null);
  }, [pendingFile]);

  /** File input change handler — stages the file for preview */
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    stageFile(file);
  }, [stageFile]);

  /** Send the pending file — encrypt client-side, upload to server, send metadata via E2EE */
  const handleSendFile = useCallback(async () => {
    if (!pendingFile || !roomId || isUploadingFile) return;
    const file = pendingFile.file;

    setIsUploadingFile(true);
    setUploadStatus('Encrypting...');

    try {
      // Step 1: Read file into bytes
      const arrayBuffer = await file.arrayBuffer();
      const plainBytes = new Uint8Array(arrayBuffer);

      // Step 2: Encrypt client-side with AES-256-GCM (server never sees plaintext)
      const { encryptedBytes, key: fileKey, iv: fileIv } = await encryptFile(plainBytes);

      // Step 3: Upload encrypted blob to server
      setUploadStatus(`Uploading (${formatFileSize(file.size)})...`);
      const uploadResult = await uploadFile(
        encryptedBytes,
        roomId,
        file.name,
        file.type || 'application/octet-stream',
      );

      // Step 4: Send file metadata via E2EE message (no file content in message — just the ID + key)
      setUploadStatus('Securing...');
      const isImage = file.type.startsWith('image/');

      const plaintext: Record<string, unknown> = {
        msgtype: isImage ? 'm.image' : 'm.file',
        body: file.name,
        filename: file.name,
        fileId: uploadResult.fileId,
        fileKey,
        fileIv,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
      };
      if (viewOnceMode) {
        plaintext.viewOnce = true;
      }

      const encryptedContent = await encryptForRoom(
        roomId,
        'm.room.message',
        plaintext,
        memberUserIds,
      );

      await sendMessage(roomId, 'm.room.encrypted', encryptedContent);

      // Clean up
      if (pendingFile.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
      setPendingFile(null);
      playSendSound();
      showToast?.('success', 'File sent securely', { duration: 2000 });
    } catch (err) {
      console.error('[FileAttach] Send failed:', err);
      playErrorSound();
      const msg = err instanceof Error ? err.message : 'Failed to send file';
      showToast?.('error', `File send failed: ${msg}`, { duration: 5000, dedupeKey: 'file-fail' });
    } finally {
      setIsUploadingFile(false);
      setUploadStatus(null);
    }
  }, [pendingFile, roomId, isUploadingFile, memberUserIds, showToast]);

  /** Handle captured photo from CameraCapture — encrypt, upload, send as E2EE image */
  const handleCameraCapture = useCallback(async (file: File) => {
    setShowCamera(false);
    setCameraStream(null);

    setIsUploadingFile(true);
    setUploadStatus('Encrypting...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const plainBytes = new Uint8Array(arrayBuffer);

      const { encryptedBytes, key: fileKey, iv: fileIv } = await encryptFile(plainBytes);

      setUploadStatus(`Uploading (${formatFileSize(file.size)})...`);
      const uploadResult = await uploadFile(
        encryptedBytes,
        roomId,
        file.name,
        file.type || 'image/jpeg',
      );

      setUploadStatus('Securing...');

      const plaintext: Record<string, unknown> = {
        msgtype: 'm.image',
        body: file.name,
        filename: file.name,
        fileId: uploadResult.fileId,
        fileKey,
        fileIv,
        mimeType: file.type || 'image/jpeg',
        fileSize: file.size,
      };
      if (viewOnceMode) {
        plaintext.viewOnce = true;
      }

      const encryptedContent = await encryptForRoom(
        roomId,
        'm.room.message',
        plaintext,
        memberUserIds,
      );

      await sendMessage(roomId, 'm.room.encrypted', encryptedContent);
      playSendSound();
      if (viewOnceMode) setViewOnceMode(false);
      showToast?.('success', 'Photo sent securely', { duration: 2000 });
    } catch (err) {
      console.error('[CameraCapture] Send failed:', err);
      playErrorSound();
      const msg = err instanceof Error ? err.message : 'Failed to send photo';
      showToast?.('error', `Photo send failed: ${msg}`, { duration: 5000, dedupeKey: 'camera-fail' });
    } finally {
      setIsUploadingFile(false);
      setUploadStatus(null);
    }
  }, [roomId, memberUserIds, showToast]);

  // ── Paste handler: capture images from clipboard ──
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        // eslint-disable-next-line security/detect-object-injection
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            // Give pasted images a descriptive name
            const ext = file.type.split('/')[1] || 'png';
            const namedFile = new File([file], `pasted-image-${Date.now()}.${ext}`, { type: file.type });
            stageFile(namedFile);
          }
          return;
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [stageFile]);

  // ── Drag and drop handlers ──
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      stageFile(files[0]);
    }
  }, [stageFile]);

  const handleRetry = (om: OptimisticMessage) => {
    setOptimisticMessages((prev) => prev.filter((m) => m.id !== om.id));
    void handleSend(om.body);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // If a file is staged, send the file instead of text
      if (pendingFile) {
        void handleSendFile();
      } else {
        void handleSend();
      }
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    const lineHeight = 20;
    const maxHeight = lineHeight * 5 + 16;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;

    // Send typing indicator (throttled to every 3 seconds).
    // Respects user privacy preference — if disabled, no typing state is sent.
    if (getSendTypingIndicators()) {
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
      if (getSendTypingIndicators()) {
        setTyping(roomId, false).catch(() => undefined);
      }
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
    const lastClick = lastClickTimeRef.current[eventId] || 0;
    if (now - lastClick < 350) {
      // Double-click detected — toggle heart reaction
      void handleReactRef.current?.(eventId, '\u2764\uFE0F');
      lastClickTimeRef.current[eventId] = 0;
    } else {
      lastClickTimeRef.current[eventId] = now;
    }
  }, []);

  // ── Long-press handlers for mobile context menu (item 10) ──
  const handleTouchStart = useCallback((eventId: string, _senderId: string) => {
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

  // Send read receipts for new messages from other users.
  // Respects user privacy preference — if disabled, no read receipt is sent.
  // Note: read receipts are intentionally unencrypted because the server needs
  // to track delivery state (which event was read) to relay receipts to peers.
  useEffect(() => {
    if (messages.length === 0) return;
    const latestOther = [...messages]
      .reverse()
      .find((m) => m.event.senderId !== currentUserId);
    if (latestOther && !readEventIds.has(latestOther.event.eventId)) {
      setReadEventIds((prev) => new Set(prev).add(latestOther.event.eventId));
      if (getSendReadReceipts()) {
        markAsRead(latestOther.event.eventId).catch((err) =>
          console.error('Failed to send read receipt:', err),
        );
      }
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

  function parseContentIfString(content: unknown): Record<string, unknown> | null {
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

  function isAudioMessage(content: unknown): boolean {
    const obj = parseContentIfString(content);
    return obj != null && obj.msgtype === 'm.audio' && typeof obj.audioData === 'string';
  }

  function getAudioContent(content: unknown): { audioData: string; duration: number; mimeType?: string } | null {
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

  function isFileMessage(content: unknown): boolean {
    const obj = parseContentIfString(content);
    if (obj == null) return false;
    const mt = obj.msgtype;
    if (mt !== 'm.file' && mt !== 'm.image') return false;
    // Support both inline (fileData) and server-hosted (fileId)
    return typeof obj.fileId === 'string' || typeof obj.fileData === 'string';
  }

  function getFileContent(content: unknown): {
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

  // E2EE badge in header is sufficient — per-message shields are visual noise
  const renderEncryptionIcon = (_decrypted: DecryptedEvent): React.ReactNode => null;

  const renderSendStatus = (status: MessageSendStatus): React.ReactNode => {
    switch (status) {
      case 'sending':
        return <span style={styles.statusIcon} title="Sending">&#128337;</span>;
      case 'sent':
        return <span style={{ ...styles.statusIconSent, color: '#3fb950' }} title="Sent">&#10003;</span>;
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
      // Use tactical codename derived from senderId + roomId for anonymous rooms
      return generateCodename(senderId + roomId);
    }
    // Prefer the server-provided display name so renamed users are shown correctly
    return senderDisplayName || formatDisplayName(senderId);
  }, [isAnonymous, roomId]);

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

  // Scroll to current search match when navigating
  useEffect(() => {
    if (!searchQuery.trim() || filteredMessages.length === 0) return;
    const clampedIndex = Math.min(searchMatchIndex, filteredMessages.length - 1);
    const targetEvent = filteredMessages[clampedIndex];
    if (targetEvent) {
      const el = messageRefs.current[targetEvent.event.eventId];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [searchMatchIndex, searchQuery, filteredMessages]);

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
        const msg = j < msgsToRender.length ? msgsToRender[j] : null;
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
      const isSelfDestructing = selfDestructingIds.has(event.eventId);
      const isDestroyed = destroyedIds.has(event.eventId);
      const isViewOnce = decrypted.plaintext && decrypted.plaintext.viewOnce === true;
      const isHiddenOnce = hiddenOnceIds.has(event.eventId);
      // eslint-disable-next-line security/detect-object-injection
      const collapsedCount = undecryptableRunStart.has(i) ? undecryptableRunLength[i] : 0;

      // Show "MESSAGE DESTROYED" placeholder for recently destroyed messages
      if (isDestroyed) {
        elements.push(
          <div key={event.eventId} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            alignSelf: isOwn ? 'flex-end' : 'flex-start',
            padding: '8px 16px', marginTop: 4,
            animation: 'frame-destruct-text-fade 2s ease-out forwards',
          }}>
            <span style={{
              fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
              color: '#f85149', letterSpacing: '0.1em', textTransform: 'uppercase' as const,
            }}>
              {'\u{1F4A3}'} MESSAGE DESTROYED
            </span>
          </div>
        );
        lastSenderId = event.senderId;
        lastTimestamp = msgDate;
        lastDate = msgDate;
        continue;
      }

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

      // View-once: expired/consumed — show "Opened" placeholder
      if (isViewOnce && isHiddenOnce && !isOwn) {
        elements.push(
          <div key={event.eventId} style={{ ...styles.messageBubble, maxWidth: isMobile ? '85%' : 'clamp(180px, 65%, 480px)', ...styles.otherMessage, opacity: 0.5, alignSelf: 'flex-start' as const }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#484f58', fontStyle: 'italic', fontSize: 12, padding: '8px 12px' }}>
              <span>{'\uD83D\uDD12'}</span>
              <span>Opened</span>
            </div>
          </div>
        );
        lastSenderId = event.senderId;
        lastTimestamp = msgDate;
        lastDate = msgDate;
        continue;
      }

      // View-once: not yet revealed — show "Tap to view" placeholder (NO content in DOM)
      if (isViewOnce && !isOwn && !viewedOnceIds.has(event.eventId) && !isHiddenOnce && decrypted.plaintext) {
        const voContentType = getViewOnceType(decrypted.plaintext);
        const voPlaintext = decrypted.plaintext;
        elements.push(
          <div key={event.eventId} ref={(el) => { messageRefs.current[event.eventId] = el; }} className="frame-msg-row" style={{ display: 'flex', alignItems: 'flex-end', gap: 8, alignSelf: 'flex-start', maxWidth: isMobile ? '85%' : 'clamp(180px, 65%, 480px)', marginTop: isNewGroup ? 8 : 2, position: 'relative' as const, ...(searchQuery.trim() && filteredMessages.length > 0 && searchMatchIndex < filteredMessages.length && filteredMessages[searchMatchIndex]?.event.eventId === event.eventId ? { outline: '2px solid rgba(210, 153, 34, 0.7)', outlineOffset: 2, borderRadius: 12 } : {}) }}>
            {!isOwn && (
              <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: isNewGroup ? (isAnonymous ? '#6e40aa' : getAvatarColor(event.senderId)) : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: '#fff', flexShrink: 0, visibility: isNewGroup ? ('visible' as const) : ('hidden' as const) }}>
                {isNewGroup ? (isAnonymous ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                ) : formatDisplayName(event.senderId).charAt(0).toUpperCase()) : ''}
              </div>
            )}
            <div className="frame-msg-bubble" style={{ ...styles.messageBubble, ...(isMobile ? { padding: '10px 14px' } : {}), ...styles.otherMessage, borderRadius: 16, marginTop: 0 }}>
              {!isOwn && isNewGroup && (
                <div style={{ ...styles.senderName, color: isAnonymous ? '#bc8cff' : getAvatarColor(event.senderId) }}>
                  {DOMPurify.sanitize(resolveDisplayName(event.senderId, event.senderDisplayName), PURIFY_CONFIG)}
                </div>
              )}
              <button
                onClick={() => revealViewOnce(event.eventId, voPlaintext)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '12px 16px', borderRadius: 12,
                  backgroundColor: 'rgba(88, 166, 255, 0.06)',
                  border: '1px dashed rgba(88, 166, 255, 0.3)',
                  cursor: 'pointer', color: '#58a6ff',
                  fontStyle: 'italic', fontSize: 13,
                  width: '100%', textAlign: 'left' as const,
                  background: 'none',
                }}
              >
                <span>{'\uD83D\uDC41'}</span>
                <span>{voContentType}</span>
                <span style={{ color: '#8b949e', fontSize: 11 }}>Tap to view</span>
              </button>
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
        ? { borderTopLeftRadius: 16, borderTopRightRadius: isFirstInGroup ? 16 : 4, borderBottomLeftRadius: 16, borderBottomRightRadius: isLastInGroup ? 4 : 4 }
        : { borderTopLeftRadius: isFirstInGroup ? 16 : 4, borderTopRightRadius: 16, borderBottomLeftRadius: isLastInGroup ? 4 : 4, borderBottomRightRadius: 16 };

      const hasPopIn = recentlyArrivedIds.has(event.eventId);
      elements.push(
        <div
          key={event.eventId}
          ref={(el) => { messageRefs.current[event.eventId] = el; }}
          className="frame-msg-row"
          style={{
            display: 'flex', alignItems: 'flex-end', gap: 8,
            alignSelf: isOwn ? 'flex-end' : 'flex-start',
            maxWidth: isMobile ? '85%' : 'clamp(180px, 65%, 480px)',
            marginTop: isFirstInGroup ? 8 : 2,
            position: 'relative' as const,
            ...(isSelfDestructing ? { animation: 'frame-self-destruct 0.8s ease-in forwards', overflow: 'hidden' as const } : hasPopIn ? { animation: 'frame-msg-pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' } : {}),
            ...(searchQuery.trim() && filteredMessages.length > 0 && searchMatchIndex < filteredMessages.length && filteredMessages[searchMatchIndex]?.event.eventId === event.eventId ? { outline: '2px solid rgba(210, 153, 34, 0.7)', outlineOffset: 2, borderRadius: 12 } : {}),
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
            className="frame-msg-bubble"
            style={{ ...styles.messageBubble, ...(isMobile ? { padding: '10px 14px', fontSize: 'clamp(14px, 3.8vw, 16px)' } : {}), ...(isOwn ? styles.ownMessage : styles.otherMessage), ...(hasError ? styles.previousSessionMessage : {}), ...bubbleRadius, marginTop: 0, position: 'relative' as const }}
            onContextMenu={isMobile ? undefined : (e) => handleMessageContextMenu(e, event.eventId, event.senderId)}
            onClick={(e) => handleMessageClick(e, event.eventId)}
          >
            {/* Reply quote block */}
            {decrypted.plaintext != null && Boolean(decrypted.plaintext.replyTo) && (() => {
              const rt = decrypted.plaintext.replyTo as { eventId: string; senderId: string; body: string };
              const _replyColor = isAnonymous ? '#bc8cff' : getAvatarColor(rt.senderId);
              return (
                <div
                  className="frame-reply-quote"
                  style={{ borderLeft: `3px solid ${isOwn ? 'rgba(255,255,255,0.5)' : '#58a6ff'}`, backgroundColor: isOwn ? 'rgba(255,255,255,0.08)' : 'rgba(88,166,255,0.06)', borderRadius: '0 8px 8px 0', padding: '6px 10px', marginBottom: 6, marginTop: 0, cursor: 'pointer', maxWidth: '100%', overflow: 'hidden', transition: 'background-color 0.15s' }}
                  onClick={(e) => { e.stopPropagation(); scrollToMessage(rt.eventId); }}
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
                  {/* Hide encryption icon on emoji-only messages */}
                  {(() => {
                    if (!hasError && decrypted.plaintext && !isFileMessage(decrypted.plaintext) && !isAudioMessage(decrypted.plaintext)) {
                      const txt = renderMessageContent(decrypted);
                      const emojiOnlyCheck = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]{1,10}$/u;
                      if (emojiOnlyCheck.test(txt.trim()) && txt.trim().length <= 12) return null;
                    }
                    return renderEncryptionIcon(decrypted);
                  })()}
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
                            onConsumed={isViewOnce ? () => setConsumedOnceIds((prev) => {
                              const next = new Set(prev);
                              next.add(event.eventId);
                              try { localStorage.setItem('frame-consumed-once', JSON.stringify([...next])); } catch { /* ignore localStorage errors */ }
                              return next;
                            }) : undefined}
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
                            onConsumed={isViewOnce ? () => setConsumedOnceIds((prev) => {
                              const next = new Set(prev);
                              next.add(event.eventId);
                              try { localStorage.setItem('frame-consumed-once', JSON.stringify([...next])); } catch { /* ignore localStorage errors */ }
                              return next;
                            }) : undefined}
                          />
                        ) : null;
                      })()
                    : <span className={isOwn ? 'frame-msg-text-own' : 'frame-msg-text'} style={(() => {
                      const t = renderMessageContent(decrypted);
                      const emojiOnly = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]{1,10}$/u;
                      if (emojiOnly.test(t.trim()) && t.trim().length <= 12) return { fontSize: 32, lineHeight: 1.3, textAlign: 'center' as const, display: 'block', padding: 0 };
                      return {};
                    })()}>{(() => {
                      const text = renderMessageContent(decrypted);
                      if (!searchQuery.trim()) return linkifyText(text, isOwn);
                      const q = searchQuery.toLowerCase();
                      const lower = text.toLowerCase();
                      if (!lower.includes(q)) return linkifyText(text, isOwn);
                      // Determine if this message is the current search match
                      const isCurrentMatch = filteredMessages.length > 0 &&
                        searchMatchIndex < filteredMessages.length &&
                        filteredMessages[searchMatchIndex]?.event.eventId === event.eventId;
                      // Highlight ALL occurrences of the search term
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
                            padding: '0 1px',
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
                    // Read — blue double check
                    return <span style={{ ...styles.readReceiptIcon, color: '#58a6ff', opacity: 1 }} title={`Read${receipt.readAt ? ' at ' + formatFullTimestamp(receipt.readAt) : ''}`}>{'\u2713\u2713'}</span>;
                  }
                  // Sent — single check
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
  }, [messages, filteredMessages, currentUserId, deletedEventIds, expiredEventIds, selfDestructingIds, destroyedIds, disappearingSettings, hiddenOnceIds, viewedOnceIds, recentlyArrivedIds, recentlyEncryptedIds, localReactions, readReceiptMap, scrollToMessage, searchQuery, searchMatchIndex, unreadDividerEventId, handleMessageClick, isMobile, handleTouchStart, handleTouchEnd, handleTouchMove, revealViewOnce, getViewOnceType]);

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
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ filter: 'drop-shadow(0 0 3px rgba(63,185,80,0.5))' }}><path d="M8 1L2 4v4.5c0 3.5 2.5 6.2 6 7.5 3.5-1.3 6-4 6-7.5V4L8 1z" stroke="#3fb950" strokeWidth="1.2" fill="rgba(63,185,80,0.1)" /><path d="M6 8.5l1.5 1.5L10.5 6" stroke="#3fb950" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg> F.R.A.M.E. E2EE
        </div>
      </div>
    );
  };

  return (
    <div
      style={styles.container}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* E2EE handshake animation overlay — plays once per room per session */}
      {!e2eeAnimDone && (
        <EncryptionVisualizer roomId={roomId} onComplete={() => setE2eeAnimDone(true)} />
      )}
      {/* Drag-and-drop overlay — covers message area only, smooth fade */}
      {isDragOver && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(63, 185, 80, 0.06)',
          border: '3px dashed rgba(63, 185, 80, 0.5)',
          borderRadius: 8,
          zIndex: 9000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
          animation: 'frame-overlay-fade-in 0.2s ease-out',
          backdropFilter: 'blur(2px)',
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            color: '#3fb950', fontWeight: 600, fontSize: 16,
            padding: '32px 24px',
            backgroundColor: 'rgba(13, 17, 23, 0.85)',
            borderRadius: 16,
            border: '1px solid rgba(63, 185, 80, 0.3)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Drop to attach
            <span style={{ fontSize: 12, color: '#8b949e', fontWeight: 400 }}>Release to add file</span>
          </div>
        </div>
      )}
      {/* Secure channel green accent line */}
      <div style={{ height: 2, backgroundColor: '#3fb950', boxShadow: '0 0 8px rgba(63,185,80,0.4)', flexShrink: 0 }} />
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
            {roomType === 'group' && !isEditingName && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 9,
                fontWeight: 700,
                color: '#3fb950',
                backgroundColor: 'rgba(63, 185, 80, 0.1)',
                border: '1px solid rgba(63, 185, 80, 0.25)',
                borderRadius: 4,
                padding: '2px 6px',
                marginLeft: 4,
                fontFamily: '"SF Mono", "Fira Code", monospace',
                letterSpacing: '0.05em',
              }} title={`Mission codename: ${generateCodename(roomId)}`}>
                MISSION: {generateCodename(roomId)}
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
                    backgroundColor: STATUS_COLORS[contactStatus],
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                  title={STATUS_LABELS[contactStatus]}
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
            <ThreatLevelBadge level="secure" />
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
            onChange={(e) => { setSearchQuery(e.target.value); setSearchMatchIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); setSearchMatchIndex(0); }
              if (e.key === 'Enter' && filteredMessages.length > 0) {
                e.preventDefault();
                if (e.shiftKey) {
                  setSearchMatchIndex((prev) => (prev - 1 + filteredMessages.length) % filteredMessages.length);
                } else {
                  setSearchMatchIndex((prev) => (prev + 1) % filteredMessages.length);
                }
              }
            }}
            aria-label="Search messages"
          />
          {searchQuery && filteredMessages.length > 0 && (
            <span style={{ fontSize: 11, color: '#8b949e', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {Math.min(searchMatchIndex + 1, filteredMessages.length)} of {filteredMessages.length}
            </span>
          )}
          {searchQuery && filteredMessages.length === 0 && (
            <span style={{ fontSize: 11, color: '#f85149', flexShrink: 0, whiteSpace: 'nowrap' }}>
              No results
            </span>
          )}
          {searchQuery && filteredMessages.length > 1 && (
            <>
              <button type="button" style={{ background: 'none', border: '1px solid #30363d', borderRadius: 4, color: '#8b949e', cursor: 'pointer', padding: '2px 6px', fontSize: 14, lineHeight: 1, fontFamily: 'inherit', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setSearchMatchIndex((prev) => (prev - 1 + filteredMessages.length) % filteredMessages.length)} title="Previous match (Shift+Enter)" aria-label="Previous match">
                &#8593;
              </button>
              <button type="button" style={{ background: 'none', border: '1px solid #30363d', borderRadius: 4, color: '#8b949e', cursor: 'pointer', padding: '2px 6px', fontSize: 14, lineHeight: 1, fontFamily: 'inherit', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setSearchMatchIndex((prev) => (prev + 1) % filteredMessages.length)} title="Next match (Enter)" aria-label="Next match">
                &#8595;
              </button>
            </>
          )}
          <button type="button" style={{ ...styles.searchCloseButton, ...(isMobile ? { minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}) }} onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchMatchIndex(0); }} aria-label="Close search">
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
          <button type="button" onClick={() => { syncBackoffRef.current = 1000; const freshGen = ++syncGenRef.current; void syncLoop(freshGen); }} style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 10, fontWeight: 600, backgroundColor: 'rgba(210,153,34,0.15)', color: '#d29922', border: '1px solid rgba(210,153,34,0.3)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Retry Now</button>
        </div>
      )}

      {/* Vignette depth gradient overlays — enhanced with lateral edges */}
      <div style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 40, background: 'linear-gradient(180deg, rgba(13,17,23,0.7) 0%, transparent 100%)', pointerEvents: 'none' as const, zIndex: 2 }} />
      <div style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 40, background: 'linear-gradient(0deg, rgba(13,17,23,0.7) 0%, transparent 100%)', pointerEvents: 'none' as const, zIndex: 2 }} />
      <div className="frame-chat-vignette" />

      {/* Self-destruct red flash overlay */}
      {showDestructFlash && (
        <div style={{
          position: 'absolute' as const, inset: 0, zIndex: 50,
          backgroundColor: 'rgba(248, 81, 73, 0.05)',
          pointerEvents: 'none' as const,
          animation: 'frame-destruct-flash 100ms ease-out forwards',
        }} />
      )}

      <div ref={messageListRef} style={{ ...styles.messageList, position: 'relative' as const }} onScroll={handleScroll}>
        {/* Subtle F.R.A.M.E. watermark */}
        <div style={{ position: 'fixed' as const, bottom: 80, right: 24, pointerEvents: 'none' as const, opacity: 0.05, zIndex: 0, display: 'flex', alignItems: 'center', gap: 6 }} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 64 64" fill="none">
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
          <div key={om.id} style={{ ...styles.messageBubble, ...(isMobile ? { maxWidth: '85%', padding: '10px 14px', fontSize: 'clamp(14px, 3.8vw, 16px)' } : { maxWidth: 'clamp(180px, 65%, 480px)' }), ...styles.ownMessage, ...(om.status === 'sending' ? styles.optimisticSending : {}), ...(om.status === 'failed' ? styles.optimisticFailed : {}), alignSelf: 'flex-end' as const, ...(recentlySentIds.has(om.id) ? { animation: 'frame-msg-slide-up 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' } : {}) }}>
            <div style={styles.messageBody}>
              <span className="frame-msg-text-own">{linkifyText(om.body, true)}</span>
            </div>
            <div style={styles.timestampRow}>
              <span style={styles.timestamp} title={formatFullTimestamp(new Date(om.timestamp))}>{formatRelativeTime(new Date(om.timestamp))}</span>
              {renderSendStatus(om.status)}
              {om.status === 'failed' && (
                <button type="button" style={styles.retryInlineButton} onClick={() => handleRetry(om)} title="Retry sending">Retry</button>
              )}
            </div>
          </div>
        ))}
        {typingUsers.length > 0 && (
          <div className={isMobile ? 'frame-typing-compact' : ''} style={{ ...styles.typingIndicator, display: 'flex', ...(isMobile ? { padding: '2px 6px', minHeight: 16 } : {}) }} aria-label="Typing indicator">
            {typingUsers.map((u) => (
              <CipherTypingIndicator key={u} displayName={formatDisplayName(u)} />
            ))}
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
        <div className={isMobile ? 'frame-reply-preview-mobile' : ''} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: isMobile ? '6px 10px' : '8px 12px', borderTop: '1px solid #30363d', backgroundColor: '#1c2128' }}>
          <div style={{ flex: 1, borderLeft: `3px solid ${isAnonymous ? '#bc8cff' : getAvatarColor(replyTo.senderId)}`, paddingLeft: 8, overflow: 'hidden', minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: isAnonymous ? '#bc8cff' : getAvatarColor(replyTo.senderId), marginBottom: 2, lineHeight: 1.3 }}>
              {DOMPurify.sanitize(isAnonymous ? 'Anonymous' : formatDisplayName(replyTo.senderId), PURIFY_CONFIG)}
            </div>
            <div className="frame-reply-body" style={{ fontSize: 12, color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: isMobile ? 'calc(100vw - 100px)' : undefined }}>
              {DOMPurify.sanitize(replyTo.body.length > (isMobile ? 60 : 100) ? replyTo.body.slice(0, isMobile ? 60 : 100) + '...' : replyTo.body, PURIFY_CONFIG)}
            </div>
          </div>
          <button type="button" onClick={handleCancelReply} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 16, cursor: 'pointer', padding: '2px 6px', borderRadius: 4, lineHeight: 1, fontFamily: 'inherit', flexShrink: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Cancel reply" aria-label="Cancel reply">
            &#10005;
          </button>
        </div>
      )}

      {/* Pending file preview bar — clean card above input */}
      {pendingFile && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12,
          padding: isMobile ? '8px 10px' : '10px 16px',
          borderTop: '1px solid #30363d', backgroundColor: '#161b22',
          animation: 'frame-overlay-fade-in 0.15s ease-out',
        }}>
          {/* Thumbnail or file icon */}
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
          {/* File info */}
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <div style={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, color: '#c9d1d9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {pendingFile.file.name}
            </div>
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
              {formatFileSize(pendingFile.file.size)}
            </div>
          </div>
          {/* Close (cancel) button */}
          <button
            type="button"
            onClick={cancelPendingFile}
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
          {/* Send button */}
          <button
            type="button"
            onClick={() => { void handleSendFile(); }}
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

      {/* Input area — WhatsApp-style rounded bar */}
      {isRecordingVoice ? (
        <div className="frame-chat-input-area" style={{ borderTop: '1px solid rgba(248,81,73,0.3)', backgroundColor: 'rgba(248,81,73,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, backgroundColor: '#0d1117', borderRadius: 24, border: '1px solid rgba(248,81,73,0.4)', padding: '4px 6px 4px 12px', gap: 4 }}>
            <VoiceRecorder
              onSend={(audio, dur, mime) => { void handleVoiceSend(audio, dur, mime); }}
              onCancel={() => { setIsRecordingVoice(false); setVoiceStream(null); }}
              stream={voiceStream}
            />
          </div>
        </div>
      ) : (
      <div className="frame-chat-input-area" style={{ borderTop: replyTo ? 'none' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', flex: 1, backgroundColor: '#0d1117', borderRadius: 24, border: isTextareaFocused ? '1px solid #3fb950' : '1px solid #30363d', transition: 'border-color 0.2s, box-shadow 0.2s', padding: '4px 6px 4px 12px', gap: 4, position: 'relative' as const, ...(isTextareaFocused ? { boxShadow: '0 0 0 2px rgba(63,185,80,0.1)' } : {}) }}>
          {/* File attachment */}
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_ACCEPT_STRING}
            style={{ display: 'none' }}
            onChange={handleFileSelect}
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
          {/* Camera capture — mobile only */}
          {isMobile && (<button
            type="button"
            title="Take photo"
            aria-label="Take photo"
            onClick={() => { void (async () => {
              try {
                (window as unknown as Record<string, unknown>).__framePermissionPending = true;
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                (window as unknown as Record<string, unknown>).__framePermissionPending = false;
                setCameraStream(stream);
                setShowCamera(true);
              } catch {
                (window as unknown as Record<string, unknown>).__framePermissionPending = false;
                showToast?.('error', 'Camera access denied. Check your browser permissions.', { duration: 5000 });
              }
            })(); }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.7,
              flexShrink: 0,
              alignSelf: 'flex-end',
              marginBottom: 1,
              borderRadius: '50%',
              transition: 'opacity 0.15s, background-color 0.15s',
              minWidth: 36,
              minHeight: 36,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>)}
          {/* View-once toggle with pill badge — compact on mobile */}
          <button type="button" onClick={() => setViewOnceMode((v) => !v)} title={viewOnceMode ? 'View-once enabled' : 'Enable view-once mode'} aria-label="Toggle view-once mode" style={{ background: viewOnceMode ? 'rgba(217,158,36,0.2)' : 'none', border: 'none', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 2 : 4, flexShrink: 0, alignSelf: 'flex-end', marginBottom: 1, borderRadius: '50%', transition: 'background-color 0.15s', minWidth: 36, minHeight: 36 }}>
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
          <div ref={emojiPickerRef} style={{ position: 'relative' as const, flexShrink: 0, alignSelf: 'flex-end', marginBottom: 1 }}>
            <button type="button" onClick={() => { if (isMobile) { setShowMobileEmojiSheet((v) => !v); } else { setShowEmojiPicker((v) => !v); } }} title="Insert emoji" aria-label="Emoji picker" style={{ background: (showEmojiPicker || showMobileEmojiSheet) ? 'rgba(88,166,255,0.15)' : 'none', border: 'none', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', transition: 'background-color 0.15s', minWidth: 36, minHeight: 36 }}>
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
          {/* Mic button — show when no text typed */}
          {!inputValue.trim() && (
            <button type="button" onClick={() => { void (async () => {
              // Acquire mic stream IN the click handler to preserve user gesture chain.
              // Browsers block getUserMedia if called outside a direct user interaction.
              try {
                (window as unknown as Record<string, unknown>).__framePermissionPending = true;
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                (window as unknown as Record<string, unknown>).__framePermissionPending = false;
                setVoiceStream(stream);
                setIsRecordingVoice(true);
              } catch {
                (window as unknown as Record<string, unknown>).__framePermissionPending = false;
                showToast?.('error', 'Microphone access denied. Check your browser permissions.', { duration: 5000 });
              }
            })(); }} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-end', marginBottom: 1, borderRadius: '50%', transition: 'color 0.15s, background-color 0.15s', minWidth: 44, minHeight: 44 }} title="Record voice message" aria-label="Record voice message" onMouseEnter={(e) => { e.currentTarget.style.color = '#3fb950'; e.currentTarget.style.backgroundColor = 'rgba(63,185,80,0.1)'; }} onMouseLeave={(e) => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.backgroundColor = 'transparent'; }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
            </button>
          )}
          {/* Send button — only when text exists. 44px min touch target on mobile */}
          {inputValue.trim() && (
            <button style={{ padding: 8, borderRadius: '50%', border: 'none', backgroundColor: '#238636', color: '#fff', cursor: isSending ? 'not-allowed' : 'pointer', transition: 'background-color 0.15s, opacity 0.15s, transform 0.15s', alignSelf: 'flex-end', flexShrink: 0, marginBottom: 1, opacity: isSending ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44, boxShadow: '0 2px 8px rgba(35, 134, 54, 0.3)', ...(sendButtonAnimating ? { animation: 'frame-send-launch 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' } : {}) }} onClick={() => void handleSend()} disabled={isSending} aria-label="Send message">
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
          onCapture={(file) => { void handleCameraCapture(file); }}
          onClose={() => { setShowCamera(false); setCameraStream(null); }}
        />
      )}

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
  container: { display: 'flex', flexDirection: 'column', height: '100%', fontFamily: FONT_BODY, border: '1px solid #21262d', borderRadius: 0, overflow: 'hidden', backgroundColor: '#0d1117', position: 'relative' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', borderBottom: '1px solid #30363d', backgroundColor: '#161b22' },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  headerNameRow: { display: 'flex', alignItems: 'center', gap: 6 },
  headerName: { fontSize: 'clamp(12px, 1.3vw, 15px)', fontWeight: 600, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  verifiedBadge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', backgroundColor: 'rgba(35, 134, 54, 0.2)', color: '#3fb950', fontSize: 10, fontWeight: 700, flexShrink: 0 },
  headerSubRow: { display: 'flex', alignItems: 'center', gap: 8 },
  headerMemberCount: { fontSize: 12, color: '#8b949e' },
  infoButton: { width: 28, height: 28, borderRadius: '50%', border: '1px solid #30363d', backgroundColor: 'transparent', color: '#c9d1d9', fontSize: 14, fontWeight: 600, fontStyle: 'italic', fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'border-color 0.15s, color 0.15s' },
  renameInput: { fontSize: 15, fontWeight: 600, color: '#e6edf3', backgroundColor: '#0d1117', border: '1px solid #58a6ff', borderRadius: 4, padding: '2px 6px', fontFamily: 'inherit', outline: 'none', width: '100%', maxWidth: 240 },
  encryptionBadge: { fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 1, backgroundColor: 'rgba(63, 185, 80, 0.08)', color: '#3fb950', border: '2px solid rgba(63, 185, 80, 0.4)', textTransform: 'uppercase' as const, letterSpacing: '0.12em', boxShadow: '0 0 6px rgba(63,185,80,0.2), inset 0 0 4px rgba(63,185,80,0.08)', fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace' },
  roomLabel: { fontSize: 13, color: '#c9d1d9' },
  syncErrorIndicator: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 14px', backgroundColor: 'rgba(210, 153, 34, 0.08)', borderBottom: '1px solid rgba(210, 153, 34, 0.15)' },
  messageList: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 2, scrollBehavior: 'smooth' as const, WebkitOverflowScrolling: 'touch' as const },
  dateSeparator: { display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '16px 0 8px' },
  dateSeparatorLine: { display: 'none' as const },
  dateSeparatorText: { fontSize: 12, fontWeight: 600, color: '#8b949e', letterSpacing: '0.03em', flexShrink: 0, backgroundColor: 'rgba(33, 38, 45, 0.85)', padding: '4px 14px', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
  timeGap: { display: 'flex', justifyContent: 'center', margin: '8px 0 4px' },
  timeGapText: { fontSize: 10, color: '#8b949e', backgroundColor: '#161b22', padding: '2px 10px', borderRadius: 10 },
  emptyState: { textAlign: 'center', color: '#8b949e', marginTop: 40, fontSize: 14 },
  messageBubble: { maxWidth: 'clamp(180px, 65%, 480px)', minWidth: 80, padding: '10px 14px', borderRadius: 16, fontSize: 'clamp(13px, 1.4vw, 15px)', lineHeight: 1.5, wordBreak: 'break-word' as const, overflowWrap: 'break-word' as const, overflow: 'hidden' as const, transition: 'background-color 0.15s' },
  ownMessage: { backgroundColor: '#1B6EF3', color: '#ffffff' },
  otherMessage: { backgroundColor: '#2D333B', color: '#e6edf3' },
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
  senderName: { fontSize: 12, fontWeight: 700, marginBottom: 3, letterSpacing: '0.01em' },
  messageBody: { display: 'flex', alignItems: 'flex-start', gap: 3, overflowWrap: 'break-word' as const, wordBreak: 'break-word' as const },
  encryptionLock: { fontSize: 10, flexShrink: 0, marginTop: 2, opacity: 0.75, filter: 'drop-shadow(0 0 4px rgba(63,185,80,0.6)) drop-shadow(0 0 8px rgba(63,185,80,0.3))', color: '#3fb950' },
  encryptionWarning: { fontSize: 14, color: '#8b949e', flexShrink: 0, marginTop: -1 },
  decryptErrorInline: { display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'help' },
  errorText: { fontStyle: 'italic', opacity: 0.8, fontSize: 13, color: '#8b949e' },
  timestampRow: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  timestamp: { fontSize: 11, opacity: 0.5, textAlign: 'right', color: 'inherit', letterSpacing: '0.02em' },
  statusIcon: { fontSize: 10, opacity: 0.6 },
  statusIconSent: { fontSize: 11, color: '#ffffff', opacity: 0.8 },
  statusIconFailed: { fontSize: 12, color: '#f85149' },
  retryInlineButton: { padding: '1px 6px', fontSize: 10, fontWeight: 600, backgroundColor: 'rgba(248, 81, 73, 0.2)', color: '#f85149', border: '1px solid rgba(248, 81, 73, 0.4)', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit', marginLeft: 2 },
  deletedText: { fontStyle: 'italic', color: '#8b949e', opacity: 0.7 },
  contextMenu: { position: 'fixed' as const, zIndex: 9999, backgroundColor: '#1c2128', border: '1px solid rgba(99, 110, 123, 0.25)', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)', padding: 6, minWidth: 140, backdropFilter: 'blur(12px)', animation: 'frame-context-menu-in 0.15s ease-out' },
  contextMenuItem: { display: 'block', width: '100%', padding: '8px 14px', fontSize: 13, color: '#f85149', backgroundColor: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left' as const, fontFamily: 'inherit', transition: 'background-color 0.12s' },
  expiredText: { fontStyle: 'italic', color: '#8b949e', opacity: 0.6 },
  leaveButton: { padding: '4px 10px', fontSize: 11, fontWeight: 600, backgroundColor: 'rgba(248, 81, 73, 0.1)', color: '#f85149', border: '1px solid rgba(248, 81, 73, 0.3)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' },
  disappearingButton: { padding: '4px 8px', fontSize: 10, fontWeight: 600, backgroundColor: 'transparent', color: '#8b949e', border: '1px solid #30363d', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' as const },
  disappearingButtonActive: { backgroundColor: 'rgba(210, 153, 34, 0.15)', color: '#d29922', borderColor: '#d29922' },
  disappearingMenu: { position: 'absolute' as const, top: '100%', right: 0, marginTop: 4, backgroundColor: '#21262d', border: '1px solid #30363d', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: 6, zIndex: 100, minWidth: 160 },
  disappearingMenuTitle: { fontSize: 11, fontWeight: 600, color: '#8b949e', padding: '4px 8px 6px', borderBottom: '1px solid #30363d', marginBottom: 4 },
  disappearingMenuItem: { display: 'block', width: '100%', padding: '6px 8px', fontSize: 12, color: '#c9d1d9', backgroundColor: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', textAlign: 'left' as const, fontFamily: 'inherit' },
  viewOnceIcon: { fontSize: 12, flexShrink: 0, marginTop: 1, opacity: 0.7 },
  newMessagesPill: { position: 'absolute' as const, bottom: 80, left: '50%', transform: 'translateX(-50%)', padding: '8px 20px', fontSize: 13, fontWeight: 600, color: '#ffffff', backgroundColor: '#1B6EF3', border: 'none', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(27,110,243,0.35)', zIndex: 10, transition: 'opacity 0.2s, transform 0.15s', letterSpacing: '0.02em' },
  typingIndicator: { display: 'none', alignItems: 'center', gap: 4, padding: '4px 8px', marginTop: 4, alignSelf: 'flex-start', minHeight: 20 },
  typingDot: { width: 6, height: 6, borderRadius: '50%', backgroundColor: '#484f58', animation: 'frame-typing-bounce 1.4s infinite ease-in-out' },
  welcomeContainer: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center', flex: 1 },
  welcomeIconWrap: { marginBottom: 12, opacity: 0.7 },
  welcomeTitle: { fontSize: 15, fontWeight: 600, color: '#e6edf3', marginBottom: 8, maxWidth: 320, lineHeight: 1.4 },
  welcomeSubtitle: { fontSize: 13, color: '#8b949e', marginBottom: 12 },
  welcomeE2eeBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 2, backgroundColor: 'rgba(35, 134, 54, 0.08)', color: '#3fb950', fontSize: 11, fontWeight: 600, border: '1px solid rgba(63, 185, 80, 0.3)', letterSpacing: '0.06em', textTransform: 'uppercase' as const },
  reactionsRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 4, marginTop: 4 },
  reactionBadge: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', fontSize: 12, borderRadius: 10, border: '1px solid #30363d', backgroundColor: 'rgba(33, 38, 45, 0.8)', color: '#c9d1d9', cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color 0.15s, background-color 0.15s', lineHeight: 1.3 },
  reactionBadgeOwn: { borderColor: '#58a6ff', backgroundColor: 'rgba(88, 166, 255, 0.15)' },
  hoverActionButton: { width: 24, height: 24, borderRadius: 6, border: 'none', backgroundColor: 'transparent', color: '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, transition: 'color 0.15s, background-color 0.15s', fontFamily: 'inherit', lineHeight: 1 },
  reactionPicker: { position: 'fixed' as const, zIndex: 9999, display: 'flex', gap: 2, padding: '4px 6px', backgroundColor: '#1c2128', border: '1px solid rgba(99, 110, 123, 0.35)', borderRadius: 20, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', animation: 'frame-context-menu-in 0.15s ease-out' },
  reactionPickerEmoji: { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, backgroundColor: 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer', transition: 'background-color 0.12s, transform 0.12s', fontFamily: 'inherit' },
  readReceiptIcon: { fontSize: 12, color: 'rgba(255,255,255,0.5)', opacity: 0.9, marginLeft: 2 },
  forwardOverlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  forwardDialog: { backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 12, width: 320, maxHeight: 420, display: 'flex', flexDirection: 'column' as const, boxShadow: '0 16px 48px rgba(0,0,0,0.5)', animation: 'frame-context-menu-in 0.15s ease-out', overflow: 'hidden' },
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
