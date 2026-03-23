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
import { leaveRoom } from '../api/roomsAPI';
import { getUserStatus } from '../api/authAPI';
import type { UserStatus } from '../api/authAPI';
import { blockUser } from '../api/blocksAPI';
import { formatDisplayName } from '../utils/displayName';
import { generateCodename } from '../utils/codenames';
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
  /** Toast notification callback */
  showToast?: (type: 'success' | 'error' | 'info' | 'warning', message: string, options?: { persistent?: boolean; dedupeKey?: string; duration?: number }) => void;
}

// ── localStorage helpers ──

const STARRED_KEY = 'frame:starred-rooms';
const ARCHIVED_KEY = 'frame:archived-rooms';
const ACCEPTED_KEY = 'frame-accepted-rooms';

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
  // Check for local nickname first (per-user rename)
  try {
    const nickname = localStorage.getItem(`frame-room-nickname:${room.roomId}`);
    if (nickname) {
      return DOMPurify.sanitize(nickname, PURIFY_CONFIG);
    }
  } catch { /* ignore localStorage errors */ }

  if (room.name) {
    return DOMPurify.sanitize(room.name, PURIFY_CONFIG);
  }

  // Anonymous rooms: use tactical codenames instead of "Anonymous User N"
  if (room.isAnonymous) {
    const otherMembers = room.members.filter((m) => m.userId !== currentUserId);
    if (otherMembers.length === 0) return generateCodename(room.roomId);
    const names = otherMembers
      .slice(0, 3)
      .map((m) => generateCodename(m.userId + room.roomId));
    return names.join(', ');
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
    if (diffMin < 60) return `${diffMin}m`;
    if (diffHr < 24) return `${diffHr}h`;

    const isYesterday =
      diffDays === 1 ||
      (diffDays === 0 && date.getDate() !== now.getDate());
    if (isYesterday && diffDays <= 1) return '1d';

    if (diffDays < 7) return `${diffDays}d`;

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
  showToast,
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
  const [acceptedRoomIds, setAcceptedRoomIds] = useState<Set<string>>(() => getStoredSet(ACCEPTED_KEY));
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

  const acceptRoom = useCallback((roomId: string) => {
    setAcceptedRoomIds((prev) => {
      const next = new Set(prev);
      next.add(roomId);
      saveStoredSet(ACCEPTED_KEY, next);
      return next;
    });
  }, []);

  const blockAndLeaveRoom = useCallback(async (roomId: string, otherUserId: string) => {
    try {
      await blockUser(otherUserId);
      await leaveRoom(roomId);
      showToast?.('success', 'User blocked');
    } catch (err) {
      showToast?.('error', err instanceof Error ? err.message : 'Failed to block user');
    }
  }, [showToast]);

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

  // Deduplicate rooms: collapse duplicate DMs with the same user and
  // duplicate single-member group rooms with the same name into the
  // most-recently-active entry.
  const uniqueRooms = (() => {
    const seen = new Map<string, RoomSummary>();
    const getRoomTimestamp = (r: RoomSummary): number =>
      r.lastMessage?.timestamp ? new Date(r.lastMessage.timestamp).getTime() : 0;

    for (const room of rooms) {
      if (room.roomType === 'direct') {
        // Key by the other user's ID so duplicate DMs collapse
        const otherUser = room.members?.find(m => m.userId !== currentUserId)?.userId || room.roomId;
        const key = `direct:${otherUser}`;
        const existing = seen.get(key);
        if (!existing || getRoomTimestamp(room) > getRoomTimestamp(existing)) {
          seen.set(key, room);
        }
      } else {
        // Group rooms with only 1 other member (or 0) and the same name: dedup
        const otherMembers = room.members.filter(m => m.userId !== currentUserId);
        if (otherMembers.length <= 1 && room.name) {
          const key = `group:${room.name}:${otherMembers.map(m => m.userId).join(',')}`;
          const existing = seen.get(key);
          if (!existing || getRoomTimestamp(room) > getRoomTimestamp(existing)) {
            seen.set(key, room);
          }
        } else {
          // Unique group rooms — always show
          seen.set(room.roomId, room);
        }
      }
    }
    return Array.from(seen.values());
  })();

  // Filter rooms by search query (client-side)
  const filteredRooms = searchQuery.trim()
    ? uniqueRooms.filter((room) => {
        const name = getRoomDisplayName(room, currentUserId).toLowerCase();
        const query = searchQuery.trim().toLowerCase();
        return name.includes(query);
      })
    : uniqueRooms;

  // Build duplicate-name suffix map: for rooms sharing the same display name,
  // append " (2)", " (3)" etc. to disambiguate in the UI.
  const displayNameSuffix = new Map<string, string>();
  {
    const nameToRoomIds = new Map<string, string[]>();
    for (const room of filteredRooms) {
      const name = getRoomDisplayName(room, currentUserId);
      const ids = nameToRoomIds.get(name) || [];
      ids.push(room.roomId);
      nameToRoomIds.set(name, ids);
    }
    for (const [, ids] of nameToRoomIds) {
      if (ids.length > 1) {
        ids.forEach((id, idx) => {
          displayNameSuffix.set(id, idx === 0 ? '' : ` (${idx + 1})`);
        });
      }
    }
  }

  // Identify pending (not-yet-accepted) rooms
  // A room is pending if:
  // 1. It's a DM (direct) room
  // 2. The current user has NOT accepted it yet (not in localStorage set)
  // 3. The current user didn't send the last message (they didn't initiate)
  // 4. The room has a last message (it's not empty / user-created)
  const isPendingRoom = (room: RoomSummary): boolean => {
    if (acceptedRoomIds.has(room.roomId)) return false;
    if (room.roomType !== 'direct') return false;
    // If the current user sent the last message, they initiated — auto-accept
    if (room.lastMessage?.senderId === currentUserId) {
      return false;
    }
    // If there's no last message, it's a fresh room the user may have created — not pending
    if (!room.lastMessage) return false;
    return true;
  };

  // Partition rooms into sections
  const pendingRooms: RoomSummary[] = [];
  const starredRooms: RoomSummary[] = [];
  const normalRooms: RoomSummary[] = [];
  const archivedRooms: RoomSummary[] = [];

  for (const room of filteredRooms) {
    if (isPendingRoom(room)) {
      pendingRooms.push(room);
    } else if (archivedIds.has(room.roomId)) {
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
    const baseName = getRoomDisplayName(room, currentUserId);
    const displayName = baseName + (displayNameSuffix.get(room.roomId) || '');
    const unread = unreadByRoom?.[room.roomId] ?? room.unreadCount;

    // Room type dot color: green=DM, blue=group, purple=anonymous
    const roomTypeDotColor = room.isAnonymous
      ? '#bc8cff'
      : room.roomType === 'direct'
        ? '#3fb950'
        : '#58a6ff';
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
          ...(isHovered && !isSelected ? { backgroundColor: 'rgba(177, 186, 196, 0.03)' } : {}),
          ...(isFocusedByKeyboard && !isSelected ? { backgroundColor: '#1c2128', outline: '2px solid #58a6ff', outlineOffset: -2 } : {}),
          transition: 'background-color 0.15s ease, border-color 0.15s ease',
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
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: roomTypeDotColor,
              display: 'inline-block',
              flexShrink: 0,
              opacity: 0.7,
            }} title={room.isAnonymous ? 'Anonymous' : room.roomType === 'direct' ? 'DM' : 'Group'} />
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
          {/* Member count removed from room items to reduce clutter */}
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
                ? room.lastMessage.body && room.lastMessage.body !== 'Encrypted message'
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
                  : (() => {
                      // Encrypted / unreadable message — show sender name prefix
                      const senderId = room.lastMessage?.senderId;
                      let prefix = '';
                      if (senderId) {
                        if (senderId === currentUserId) {
                          prefix = 'You: ';
                        } else {
                          const senderMember = room.members.find(m => m.userId === senderId);
                          prefix = DOMPurify.sanitize(
                            senderMember?.displayName || formatDisplayName(senderId),
                            PURIFY_CONFIG,
                          ) + ': ';
                        }
                      }
                      const ts = room.lastMessage?.timestamp
                        ? ` \u00B7 ${formatRelativeTimestamp(room.lastMessage.timestamp)}`
                        : '';
                      return (
                        <em style={{ fontStyle: 'italic', color: '#6e7681' }}>
                          {prefix}New message{ts}
                        </em>
                      );
                    })()
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
            borderColor: '#30363d',
            backgroundColor: '#0d1117',
          } : {}),
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
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

      {/* Pending (accept/block) section */}
      {pendingRooms.length > 0 && (
        <>
          <div style={{
            ...styles.sectionHeader,
            color: '#d29922',
            ...(isMobile ? { fontSize: 10, padding: '8px 12px 3px', letterSpacing: '0.08em' } : {}),
          }}>
            <span style={{ marginRight: 4, fontSize: isMobile ? 9 : 10 }}>&#9888;</span>
            Message Requests ({pendingRooms.length})
          </div>
          {pendingRooms.map((room) => {
            const otherMember = room.members.find((m) => m.userId !== currentUserId);
            const senderName = otherMember
              ? DOMPurify.sanitize(otherMember.displayName || formatDisplayName(otherMember.userId), PURIFY_CONFIG)
              : 'Someone';
            const isGuest = otherMember?.userId.startsWith('@guest_') ?? false;
            return (
              <div
                key={room.roomId}
                style={{
                  padding: isMobile ? '10px 12px' : '8px 16px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                  backgroundColor: 'rgba(210, 153, 34, 0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                    {senderName}
                    {isGuest && (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: '#8b949e',
                        backgroundColor: 'rgba(139, 148, 158, 0.1)',
                        border: '1px solid rgba(139, 148, 158, 0.25)',
                        borderRadius: 3,
                        padding: '0px 4px',
                        marginLeft: 4,
                      }}>Guest</span>
                    )}
                    <span style={{ fontSize: 12, fontWeight: 400, color: '#8b949e', marginLeft: 4 }}>wants to message you</span>
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      backgroundColor: '#238636',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      ...(isMobile ? { minHeight: 40, fontSize: 14 } : {}),
                    }}
                    onClick={() => {
                      acceptRoom(room.roomId);
                      onSelectRoom(room.roomId);
                    }}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      backgroundColor: 'rgba(248, 81, 73, 0.1)',
                      color: '#f85149',
                      border: '1px solid rgba(248, 81, 73, 0.3)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      ...(isMobile ? { minHeight: 40, fontSize: 14 } : {}),
                    }}
                    onClick={() => {
                      if (otherMember) {
                        void blockAndLeaveRoom(room.roomId, otherMember.userId);
                      }
                    }}
                  >
                    Block
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Starred section */}
      {starredRooms.length > 0 && (
        <>
          <div style={{
            ...styles.sectionHeader,
            ...(isMobile ? { fontSize: 10, padding: '8px 12px 3px', letterSpacing: '0.08em' } : {}),
          }}>
            <span style={{ color: '#d29922', marginRight: 4, fontSize: isMobile ? 9 : 10 }}>&#9733;</span>
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
            {starredRooms.length > 0 ? 'All Conversations' : 'CONVERSATIONS'}
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
    padding: '10px 14px 8px',
    flexShrink: 0,
  },
  searchInputWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 12px',
    borderRadius: 8,
    border: '1px solid #21262d',
    backgroundColor: '#0d1117',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
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
    lineHeight: '20px',
  },
  searchClear: {
    background: 'none',
    border: 'none',
    color: '#8b949e',
    fontSize: 10,
    cursor: 'pointer',
    padding: '2px 6px',
    lineHeight: 1,
    fontFamily: 'inherit',
    flexShrink: 0,
    borderRadius: 4,
  },
  noResults: {
    padding: '20px 16px',
    textAlign: 'center',
    fontSize: 13,
    color: '#484f58',
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
    fontWeight: 600,
    color: '#c9d1d9',
  },
  emptyHint: {
    margin: '8px 0 0',
    fontSize: 12,
    color: '#8b949e',
  },
  sectionHeader: {
    padding: '14px 16px 6px',
    fontSize: 11,
    fontWeight: 600,
    color: '#484f58',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    display: 'flex',
    alignItems: 'center',
    fontFamily: '"SF Mono", "Fira Code", monospace',
  },
  roomItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    fontFamily: 'inherit',
    borderLeft: '3px solid transparent',
    position: 'relative' as const,
    overflow: 'hidden' as const,
    transition: 'background-color 0.15s ease, border-color 0.15s ease',
  },
  roomItemSelected: {
    backgroundColor: 'rgba(63, 185, 80, 0.06)',
    borderLeft: '3px solid #3fb950',
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
    border: 'none',
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
    gap: 6,
  },
  roomName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e6edf3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: '20px',
    display: 'block',
  },
  timestamp: {
    fontSize: 11,
    color: '#484f58',
    flexShrink: 0,
    marginLeft: 8,
  },
  roomPreview: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  memberCount: {
    fontSize: 11,
    color: '#484f58',
    marginTop: 1,
  },
  previewText: {
    fontSize: 11,
    color: '#6e7681',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: '16px',
  },
  unreadBadge: {
    backgroundColor: '#238636',
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 10,
    padding: '2px 7px',
    minWidth: 20,
    textAlign: 'center',
    flexShrink: 0,
    marginLeft: 8,
    lineHeight: '16px',
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
    borderTop: '1px solid rgba(255, 255, 255, 0.04)',
    cursor: 'pointer',
    fontSize: 12,
    color: '#484f58',
    fontFamily: 'inherit',
    width: '100%',
    textAlign: 'left',
    transition: 'color 0.15s',
  },
};

export default RoomList;
