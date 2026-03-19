/**
 * RoomList — Sidebar list of conversations for F.R.A.M.E.
 *
 * Displays the user's rooms organized into sections:
 * - Starred (pinned to top, stored in localStorage)
 * - All Conversations (non-archived rooms)
 * - Archived (collapsed by default, stored in localStorage)
 *
 * Each room shows name, last message preview, unread indicator,
 * star button, and archive action. All rendered content is sanitized via DOMPurify.
 *
 * Enhancements:
 * - Smooth transition animations when rooms reorder (starred moves to top)
 * - Unread pulse animation on rooms with new messages
 * - Swipe gesture hints for star/archive (subtle arrow indicators on hover)
 * - Online presence indicator (green dot) on room avatars
 * - Pinch/pop animation when starring
 * - Search bar focus expand animation
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
import type { RoomSummary } from '../api/roomsAPI';
import { getUserStatus } from '../api/authAPI';
import type { UserStatus } from '../api/authAPI';
import { formatDisplayName } from '../utils/displayName';
import { SkeletonRoomItem } from './Skeleton';
import { useIsMobile } from '../hooks/useIsMobile';

// ── Types ──

interface RoomListProps {
  rooms: RoomSummary[];
  selectedRoomId: string | null;
  currentUserId: string;
  onSelectRoom: (roomId: string) => void;
  /**
   * Optional override for per-room unread counts provided by the
   * notification hook. When supplied, these take precedence over
   * `room.unreadCount` from the API response.
   */
  unreadByRoom?: Record<string, number>;
  /** When true, show skeleton loading placeholders instead of the room list. */
  loading?: boolean;
  /** Ref forwarded from parent so keyboard shortcuts can focus the search bar. */
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Index of the room currently focused via keyboard navigation (arrow keys). */
  focusedRoomIndex?: number;
}

// ── localStorage helpers ──

const STARRED_KEY = 'frame:starred-rooms';
const ARCHIVED_KEY = 'frame:archived-rooms';

function getStoredSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveStoredSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

// ── Helpers ──

/**
 * Derive a display name for a room. For DMs, use the other member's
 * name. For groups, use the room name or a member list fallback.
 */
function getRoomDisplayName(
  room: RoomSummary,
  currentUserId: string,
): string {
  if (room.name) {
    return DOMPurify.sanitize(room.name, PURIFY_CONFIG);
  }

  if (room.roomType === 'direct') {
    const other = room.members.find((m) => m.userId !== currentUserId);
    if (other) {
      return DOMPurify.sanitize(other.displayName || formatDisplayName(other.userId), PURIFY_CONFIG);
    }
  }

  // Group fallback: list first 3 member names
  const names = room.members
    .filter((m) => m.userId !== currentUserId)
    .slice(0, 3)
    .map((m) => DOMPurify.sanitize(m.displayName || formatDisplayName(m.userId), PURIFY_CONFIG));

  if (names.length === 0) return 'Empty Room';
  return names.join(', ');
}

/**
 * Truncate a message preview to a reasonable length.
 */
function truncate(text: string, maxLength: number): string {
  const sanitized = DOMPurify.sanitize(text, PURIFY_CONFIG);
  if (sanitized.length <= maxLength) return sanitized;
  return sanitized.slice(0, maxLength) + '...';
}

/**
 * Format a timestamp as a relative time string (e.g., "2m ago", "Yesterday").
 */
function formatRelativeTimestamp(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHr / 24);

    if (diffSec < 60) return 'now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;

    const isYesterday =
      diffDays === 1 ||
      (diffDays === 0 && date.getDate() !== now.getDate());
    if (isYesterday && diffDays <= 1) return 'Yesterday';

    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

// ── Avatar color helper ──

const AVATAR_COLORS = ['#da3633', '#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f78166'];

function getAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ── Status color helper ──
const STATUS_COLORS: Record<UserStatus, string> = {
  online: '#3fb950',
  away: '#d29922',
  busy: '#f85149',
  offline: '#484f58',
};

// ── Inject keyframes for animations ──

function injectRoomListKeyframes(): void {
  const styleId = 'frame-roomlist-keyframes';
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes frame-unread-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(88, 166, 255, 0.4); }
      50% { box-shadow: 0 0 0 4px rgba(88, 166, 255, 0); }
    }
    @keyframes frame-star-pop {
      0% { transform: scale(1); }
      30% { transform: scale(1.5); }
      50% { transform: scale(0.85); }
      70% { transform: scale(1.15); }
      100% { transform: scale(1); }
    }
    @keyframes frame-search-glow {
      0% { box-shadow: 0 0 0 0 rgba(88, 166, 255, 0.3); }
      100% { box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.1); }
    }
    @keyframes frame-online-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    @keyframes frame-swipe-hint-left {
      0%, 100% { transform: translateX(0); opacity: 0; }
      50% { transform: translateX(-3px); opacity: 0.6; }
    }
    @keyframes frame-swipe-hint-right {
      0%, 100% { transform: translateX(0); opacity: 0; }
      50% { transform: translateX(3px); opacity: 0.6; }
    }
    @keyframes frame-room-hover-lift {
      0% { transform: translateY(0); }
      100% { transform: translateY(-1px); }
    }
    @keyframes frame-shield-float {
      0%, 100% { transform: translateY(0); opacity: 0.6; }
      50% { transform: translateY(-4px); opacity: 0.8; }
    }
  `;
  document.head.appendChild(style);
}

// ── Component ──

const RoomList: React.FC<RoomListProps> = ({
  rooms,
  selectedRoomId,
  currentUserId,
  onSelectRoom,
  unreadByRoom,
  loading,
  searchInputRef: externalSearchRef,
  focusedRoomIndex,
}) => {
  const isMobile = useIsMobile();
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [starredIds, setStarredIds] = useState<Set<string>>(() => getStoredSet(STARRED_KEY));
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => getStoredSet(ARCHIVED_KEY));
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [starAnimatingId, setStarAnimatingId] = useState<string | null>(null);
  const [userStatuses, setUserStatuses] = useState<Record<string, UserStatus>>({});
  const internalSearchRef = useRef<HTMLInputElement>(null);
  const searchInputRef = externalSearchRef || internalSearchRef;
  const roomItemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Scroll focused room into view when navigating with arrow keys
  useEffect(() => {
    if (focusedRoomIndex != null && focusedRoomIndex >= 0) {
      const el = roomItemRefs.current.get(focusedRoomIndex);
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        el.focus();
      }
    }
  }, [focusedRoomIndex]);

  // Inject animation keyframes on mount
  useEffect(() => {
    injectRoomListKeyframes();
  }, []);

  // Fetch user statuses for DM rooms
  useEffect(() => {
    if (rooms.length === 0) return;
    let cancelled = false;
    const fetchStatuses = async () => {
      const dmUserIds = rooms
        .filter((r) => r.roomType === 'direct')
        .map((r) => r.members.find((m) => m.userId !== currentUserId)?.userId)
        .filter((id): id is string => !!id);
      const unique = [...new Set(dmUserIds)];
      const results: Record<string, UserStatus> = {};
      await Promise.all(
        unique.map(async (uid) => {
          try {
            const s = await getUserStatus(uid);
            results[uid] = s.status; // eslint-disable-line security/detect-object-injection
          } catch { /* ignore */ }
        }),
      );
      if (!cancelled) setUserStatuses(results);
    };
    void fetchStatuses();
    const interval = setInterval(() => void fetchStatuses(), 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [rooms, currentUserId]);

  const toggleStar = useCallback((roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Trigger star pop animation
    setStarAnimatingId(roomId);
    setTimeout(() => setStarAnimatingId(null), 500);

    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) {
        next.delete(roomId);
      } else {
        next.add(roomId);
      }
      saveStoredSet(STARRED_KEY, next);
      return next;
    });
  }, []);

  const toggleArchive = useCallback((roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setArchivedIds((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) {
        next.delete(roomId);
      } else {
        next.add(roomId);
        // Unstar if archiving
        setStarredIds((prevStarred) => {
          const nextStarred = new Set(prevStarred);
          nextStarred.delete(roomId);
          saveStoredSet(STARRED_KEY, nextStarred);
          return nextStarred;
        });
      }
      saveStoredSet(ARCHIVED_KEY, next);
      return next;
    });
  }, []);

  // Show skeleton loading placeholders while rooms are loading
  if (loading) {
    return (
      <div style={styles.container}>
        <SkeletonRoomItem />
        <SkeletonRoomItem />
        <SkeletonRoomItem />
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <div style={{
        ...styles.emptyContainer,
        ...(isMobile ? { padding: 20, maxWidth: 260, margin: '0 auto' } : {}),
      }}>
        {/* Animated shield icon */}
        <div style={{ animation: 'frame-shield-float 3s ease-in-out infinite', marginBottom: isMobile ? 12 : 16 }}>
          <svg width={isMobile ? 32 : 40} height={isMobile ? 32 : 40} viewBox="0 0 40 40" fill="none">
            <path d="M20 3L6 10v10c0 9.33 5.97 17.53 14 20 8.03-2.47 14-10.67 14-20V10L20 3z" stroke="#58a6ff" strokeWidth="1.5" fill="rgba(88,166,255,0.06)" />
            <path d="M14 20l4 4 8-8" stroke="#3fb950" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>
        <p style={{ ...styles.emptyText, fontSize: isMobile ? 13 : 14 }}>No conversations yet</p>
        <p style={{ ...styles.emptyHint, marginTop: 4, fontSize: isMobile ? 11 : 11, color: '#6e7681', fontStyle: 'italic' }}>
          Your messages are protected by military-grade encryption
        </p>
      </div>
    );
  }

  // Filter rooms by search query (client-side)
  const filteredRooms = searchQuery.trim()
    ? rooms.filter((room) => {
        const name = getRoomDisplayName(room, currentUserId).toLowerCase();
        const query = searchQuery.trim().toLowerCase();
        return name.includes(query);
      })
    : rooms;

  // Partition rooms into sections
  const starredRooms: RoomSummary[] = [];
  const normalRooms: RoomSummary[] = [];
  const archivedRooms: RoomSummary[] = [];

  for (const room of filteredRooms) {
    if (archivedIds.has(room.roomId)) {
      archivedRooms.push(room);
    } else if (starredIds.has(room.roomId)) {
      starredRooms.push(room);
    } else {
      normalRooms.push(room);
    }
  }

  // Build a flat visible-room list so we can map indexes for keyboard nav
  const visibleRoomOrder: string[] = [
    ...starredRooms.map((r) => r.roomId),
    ...normalRooms.map((r) => r.roomId),
    ...(showArchived ? archivedRooms.map((r) => r.roomId) : []),
  ];

  const renderRoomItem = (room: RoomSummary) => {
    const isSelected = room.roomId === selectedRoomId;
    const isHovered = hoveredRoomId === room.roomId;
    const isStarred = starredIds.has(room.roomId);
    const isArchived = archivedIds.has(room.roomId);
    const displayName = getRoomDisplayName(room, currentUserId);
    const unread = unreadByRoom?.[room.roomId] ?? room.unreadCount;
    const isStarAnimating = starAnimatingId === room.roomId;
    const roomIndex = visibleRoomOrder.indexOf(room.roomId);
    const isFocusedByKeyboard = focusedRoomIndex != null && roomIndex === focusedRoomIndex;

    // Get real user status for DM rooms
    const otherUser = room.roomType === 'direct'
      ? room.members.find((m) => m.userId !== currentUserId)
      : null;
    const otherStatus: UserStatus = otherUser ? (userStatuses[otherUser.userId] || 'offline') : 'offline';
    const isOnline = otherStatus !== 'offline';
    const statusDotColor = STATUS_COLORS[otherStatus]; // eslint-disable-line security/detect-object-injection

    return (
      <button
        key={room.roomId}
        ref={(el) => {
          if (el) roomItemRefs.current.set(roomIndex, el);
          else roomItemRefs.current.delete(roomIndex);
        }}
        type="button"
        role="listitem"
        style={{
          ...styles.roomItem,
          ...(isMobile ? { minHeight: 56, padding: '10px 12px' } : {}),
          ...(isSelected ? styles.roomItemSelected : {}),
          ...(isHovered && !isSelected ? { backgroundColor: '#1c2128', transform: 'translateY(-1px)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' } : {}),
          ...(isFocusedByKeyboard && !isSelected ? { backgroundColor: '#1c2128', outline: '2px solid #58a6ff', outlineOffset: -2 } : {}),
          // Smooth transition for reordering + hover lift
          transition: 'background-color 0.2s ease, transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease, box-shadow 0.2s ease',
          // Unread pulse animation
          ...(unread > 0 && !isSelected ? {
            animation: 'frame-unread-pulse 2s ease-in-out infinite',
          } : {}),
        }}
        onClick={() => onSelectRoom(room.roomId)}
        onMouseEnter={() => setHoveredRoomId(room.roomId)}
        onMouseLeave={() => setHoveredRoomId(null)}
        aria-current={isSelected ? 'true' : undefined}
        aria-label={`${displayName}${unread > 0 ? `, ${unread} unread` : ''}`}
        tabIndex={isFocusedByKeyboard ? 0 : -1}
      >
        {/* Swipe hint left (star) — desktop only */}
        {!isMobile && isHovered && !isStarred && (
          <div style={{
            position: 'absolute' as const,
            left: 4,
            top: '50%',
            transform: 'translateY(-50%)',
            animation: 'frame-swipe-hint-left 2s ease-in-out infinite',
            color: '#d29922',
            fontSize: 10,
            pointerEvents: 'none' as const,
          }}>
            &#9733;
          </div>
        )}

        {/* Avatar with online indicator */}
        <div style={{ position: 'relative' as const, flexShrink: 0 }}>
          {room.isAnonymous ? (
            <div style={{ ...styles.avatar, backgroundColor: '#6e40aa' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            </div>
          ) : (
          <div style={{ ...styles.avatar, backgroundColor: getAvatarColor(room.roomId || displayName) }}>
            {displayName.charAt(0).toUpperCase()}
          </div>
          )}
          {/* Status indicator dot */}
          {isOnline && (
            <div style={{
              position: 'absolute' as const,
              bottom: 0,
              right: 0,
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: statusDotColor,
              border: '2px solid #161b22',
              animation: otherStatus === 'online' ? 'frame-online-pulse 3s ease-in-out infinite' : undefined,
            }} />
          )}
        </div>

        {/* Room info */}
        <div style={styles.roomInfo}>
          <div style={{
            ...styles.roomHeader,
            ...(isMobile ? { gap: 6 } : {}),
          }}>
            <span style={{
              ...styles.roomName,
              ...(unread > 0 ? { color: '#f0f6fc', fontWeight: 700 } : {}),
              minWidth: 0,
              flex: 1,
            }}>{displayName}</span>
            {room.isAnonymous && (
              <span style={{
                fontSize: 9,
                fontWeight: 600,
                color: '#bc8cff',
                backgroundColor: 'rgba(188, 140, 255, 0.1)',
                border: '1px solid rgba(188, 140, 255, 0.3)',
                borderRadius: 4,
                padding: '1px 5px',
                marginLeft: 4,
                flexShrink: 0,
              }}>Anonymous</span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <span style={{ fontSize: 10, opacity: 0.4 }} title="End-to-end encrypted">{'\u{1F512}'}</span>
              {room.lastMessage && (
                <span style={{
                  ...styles.timestamp,
                  ...(unread > 0 ? { color: '#58a6ff', fontWeight: 600 } : {}),
                }}>
                  {formatRelativeTimestamp(room.lastMessage.timestamp)}
                </span>
              )}
            </div>
          </div>
          {room.roomType === 'group' && (
            <div style={styles.memberCount}>
              {room.members.length} member{room.members.length !== 1 ? 's' : ''}
            </div>
          )}
          <div style={{
            ...styles.roomPreview,
            minWidth: 0,
          }}>
            <span style={{
              ...styles.previewText,
              ...(unread > 0 ? { color: '#c9d1d9' } : {}),
              minWidth: 0,
              flex: 1,
            }}>
              {room.lastMessage
                ? room.lastMessage.body
                  ? (() => {
                      const senderPrefix =
                        room.roomType === 'group' && room.lastMessage.senderId
                          ? `${DOMPurify.sanitize(
                              room.members.find((m) => m.userId === room.lastMessage?.senderId)?.displayName
                                || formatDisplayName(room.lastMessage.senderId),
                              PURIFY_CONFIG,
                            )}: `
                          : '';
                      return truncate(senderPrefix + (room.lastMessage?.body ?? ''), 40);
                    })()
                  : <em style={{ fontStyle: 'italic', color: '#8b949e' }}>Encrypted message</em>
                : <span style={{ fontStyle: 'italic' }}>Say hello! {'\u{1F44B}'}</span>}
            </span>
            {unread > 0 && (
              <span style={{
                ...styles.unreadBadge,
                ...(isMobile ? {
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  minWidth: 20,
                  borderRadius: 10,
                } : {}),
              }}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons (star + archive) — hidden on mobile; use swipe/long-press instead */}
        {!isMobile && (
          <div style={styles.actionButtons}>
            {/* Star button with pop animation */}
            <button
              type="button"
              style={{
                ...styles.starButton,
                ...(isStarred
                  ? { color: '#d29922', opacity: 1 }
                  : { opacity: isHovered ? 0.7 : 0 }),
                ...(isStarAnimating ? {
                  animation: 'frame-star-pop 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                } : {}),
              }}
              onClick={(e) => toggleStar(room.roomId, e)}
              title={isStarred ? 'Unstar' : 'Star'}
              aria-label={isStarred ? 'Unstar conversation' : 'Star conversation'}
            >
              {isStarred ? '\u2605' : '\u2606'}
            </button>
            {/* Archive button: visible on hover */}
            <button
              type="button"
              style={{
                ...styles.archiveButton,
                opacity: isHovered ? 0.7 : 0,
              }}
              onClick={(e) => toggleArchive(room.roomId, e)}
              title={isArchived ? 'Unarchive' : 'Archive'}
              aria-label={isArchived ? 'Unarchive conversation' : 'Archive conversation'}
            >
              {isArchived ? '\u21A9' : '\u2193'}
            </button>
          </div>
        )}

        {/* Swipe hint right (archive) — desktop only */}
        {!isMobile && isHovered && !isArchived && (
          <div style={{
            position: 'absolute' as const,
            right: 4,
            top: '50%',
            transform: 'translateY(-50%)',
            animation: 'frame-swipe-hint-right 2s ease-in-out infinite',
            color: '#484f58',
            fontSize: 10,
            pointerEvents: 'none' as const,
          }}>
            &#8615;
          </div>
        )}
      </button>
    );
  };

  return (
    <div style={styles.container} role="list" aria-label="Conversations">
      {/* Search / filter bar with focus expand animation */}
      <div style={{
        ...styles.searchContainer,
        ...(isMobile ? { padding: '8px 10px 6px' } : {}),
        ...(searchFocused && !isMobile ? { padding: '10px 8px 6px' } : {}),
        transition: 'padding 0.2s ease',
      }}>
        <div style={{
          ...styles.searchInputWrap,
          ...(isMobile ? {
            minHeight: 44,
            borderRadius: 22,
            padding: '0 14px',
            width: '100%',
          } : {}),
          ...(searchFocused ? {
            borderColor: '#58a6ff',
            backgroundColor: '#0d1117',
            animation: 'frame-search-glow 0.3s ease-out forwards',
            ...(!isMobile ? { padding: '8px 12px' } : {}),
          } : {}),
          transition: 'border-color 0.2s ease, padding 0.2s ease, box-shadow 0.3s ease',
        }}>
          <svg width={searchFocused ? 16 : 14} height={searchFocused ? 16 : 14} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{
            flexShrink: 0,
            transition: 'all 0.2s ease',
          }}>
            <circle cx="7" cy="7" r="5" stroke={searchFocused ? '#58a6ff' : '#8b949e'} strokeWidth="1.5" fill="none" />
            <path d="M11 11l3.5 3.5" stroke={searchFocused ? '#58a6ff' : '#8b949e'} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            style={{
              ...styles.searchInput,
              ...(isMobile ? { fontSize: 16 } : {}),
              ...(searchFocused && !isMobile ? { fontSize: 14 } : {}),
              transition: 'font-size 0.2s ease',
            }}
            placeholder={searchFocused ? 'Type to filter conversations...' : 'Search conversations...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            aria-label="Search conversations"
          />
          {searchQuery && (
            <button
              type="button"
              style={{
                ...styles.searchClear,
                ...(isMobile ? { padding: '8px 8px', minWidth: 32, minHeight: 32 } : {}),
              }}
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              &#10005;
            </button>
          )}
        </div>
      </div>

      {/* No results */}
      {searchQuery.trim() && filteredRooms.length === 0 && (
        <div style={styles.noResults}>No conversations match &ldquo;{searchQuery.trim()}&rdquo;</div>
      )}

      {/* Starred section */}
      {starredRooms.length > 0 && (
        <>
          <div style={{
            ...styles.sectionHeader,
            ...(isMobile ? { fontSize: 10, padding: '8px 12px 3px', letterSpacing: '0.08em' } : {}),
          }}>
            <span style={{ color: '#d29922', marginRight: 6, fontSize: isMobile ? 9 : 10 }}>&#9733;</span>
            Starred
          </div>
          {starredRooms.map(renderRoomItem)}
        </>
      )}

      {/* All Conversations section */}
      {normalRooms.length > 0 && (
        <>
          <div style={{
            ...styles.sectionHeader,
            ...(isMobile ? { fontSize: 10, padding: '8px 12px 3px', letterSpacing: '0.08em' } : {}),
          }}>
            {starredRooms.length > 0 ? 'All Conversations' : 'Conversations'}
          </div>
          {normalRooms.map(renderRoomItem)}
        </>
      )}

      {/* Archived section */}
      {archivedRooms.length > 0 && (
        <>
          <button
            type="button"
            style={styles.archivedToggle}
            onClick={() => setShowArchived((prev) => !prev)}
          >
            <span style={{
              transition: 'transform 0.2s ease',
              display: 'inline-block',
              transform: showArchived ? 'rotate(90deg)' : 'rotate(0deg)',
            }}>{'\u25B6'}</span>
            <span>Show archived ({archivedRooms.length})</span>
          </button>
          {showArchived && archivedRooms.map(renderRoomItem)}
        </>
      )}
    </div>
  );
};

// ── Styles (dark theme) ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    flex: 1,
  },
  searchContainer: {
    padding: '10px 12px 6px',
    flexShrink: 0,
  },
  searchInputWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid #30363d',
    backgroundColor: '#0d1117',
    transition: 'border-color 0.2s ease, padding 0.2s ease, box-shadow 0.3s ease',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    backgroundColor: 'transparent',
    color: '#c9d1d9',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    padding: 0,
    lineHeight: '18px',
  },
  searchClear: {
    background: 'none',
    border: 'none',
    color: '#8b949e',
    fontSize: 10,
    cursor: 'pointer',
    padding: '2px 4px',
    lineHeight: 1,
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  noResults: {
    padding: '16px',
    textAlign: 'center',
    fontSize: 13,
    color: '#8b949e',
  },
  emptyContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: 24,
  },
  emptyText: {
    margin: 0,
    fontSize: 14,
    color: '#8b949e',
  },
  emptyHint: {
    margin: '8px 0 0',
    fontSize: 12,
    color: '#8b949e',
  },
  sectionHeader: {
    padding: '10px 16px 4px',
    fontSize: 11,
    fontWeight: 600,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    display: 'flex',
    alignItems: 'center',
  },
  roomItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '1px solid #21262d',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    fontFamily: 'inherit',
    borderLeft: '3px solid transparent',
    position: 'relative' as const,
    overflow: 'hidden' as const,
  },
  roomItemSelected: {
    backgroundColor: '#1c2128',
    borderLeft: '3px solid #58a6ff',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    backgroundColor: '#30363d',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 600,
    color: '#ffffff',
    flexShrink: 0,
  },
  roomInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  roomHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roomName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e6edf3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  timestamp: {
    fontSize: 11,
    color: '#8b949e',
    flexShrink: 0,
    marginLeft: 8,
  },
  roomPreview: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  memberCount: {
    fontSize: 11,
    color: '#8b949e',
    marginTop: 1,
  },
  previewText: {
    fontSize: 13,
    color: '#8b949e',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  unreadBadge: {
    backgroundColor: '#58a6ff',
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 10,
    padding: '1px 7px',
    minWidth: 18,
    textAlign: 'center',
    flexShrink: 0,
    marginLeft: 8,
  },
  actionButtons: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  starButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    padding: '2px 4px',
    lineHeight: 1,
    color: '#8b949e',
    transition: 'opacity 0.15s, color 0.15s, transform 0.15s',
    fontFamily: 'inherit',
  },
  archiveButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    padding: '2px 4px',
    lineHeight: 1,
    color: '#8b949e',
    transition: 'opacity 0.15s',
    fontFamily: 'inherit',
  },
  archivedToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    backgroundColor: 'transparent',
    border: 'none',
    borderTop: '1px solid #21262d',
    cursor: 'pointer',
    fontSize: 12,
    color: '#8b949e',
    fontFamily: 'inherit',
    width: '100%',
    textAlign: 'left',
    transition: 'color 0.15s',
  },
};

export default RoomList;
