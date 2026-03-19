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
 */

import React, { useState, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
import type { RoomSummary } from '../api/roomsAPI';
import { formatDisplayName } from '../utils/displayName';

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
 * Format a timestamp for the room list (time if today, date otherwise).
 */
function formatTimestamp(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    if (isToday) {
      return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    }

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

// ── Component ──

const RoomList: React.FC<RoomListProps> = ({
  rooms,
  selectedRoomId,
  currentUserId,
  onSelectRoom,
  unreadByRoom,
}) => {
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [starredIds, setStarredIds] = useState<Set<string>>(() => getStoredSet(STARRED_KEY));
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => getStoredSet(ARCHIVED_KEY));
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const toggleStar = useCallback((roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
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

  if (rooms.length === 0) {
    return (
      <div style={styles.emptyContainer}>
        <p style={styles.emptyText}>No conversations yet</p>
        <p style={styles.emptyHint}>
          Start a new chat to begin messaging
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

  const renderRoomItem = (room: RoomSummary) => {
    const isSelected = room.roomId === selectedRoomId;
    const isHovered = hoveredRoomId === room.roomId;
    const isStarred = starredIds.has(room.roomId);
    const isArchived = archivedIds.has(room.roomId);
    const displayName = getRoomDisplayName(room, currentUserId);
    const unread = unreadByRoom?.[room.roomId] ?? room.unreadCount;

    return (
      <button
        key={room.roomId}
        type="button"
        style={{
          ...styles.roomItem,
          ...(isSelected ? styles.roomItemSelected : {}),
          ...(isHovered && !isSelected ? { backgroundColor: '#161b22' } : {}),
        }}
        onClick={() => onSelectRoom(room.roomId)}
        onMouseEnter={() => setHoveredRoomId(room.roomId)}
        onMouseLeave={() => setHoveredRoomId(null)}
        aria-current={isSelected ? 'true' : undefined}
      >
        {/* Avatar placeholder */}
        <div style={{ ...styles.avatar, backgroundColor: getAvatarColor(room.roomId || displayName) }}>
          {displayName.charAt(0).toUpperCase()}
        </div>

        {/* Room info */}
        <div style={styles.roomInfo}>
          <div style={styles.roomHeader}>
            <span style={styles.roomName}>{displayName}</span>
            {room.lastMessage && (
              <span style={styles.timestamp}>
                {formatTimestamp(room.lastMessage.timestamp)}
              </span>
            )}
          </div>
          {room.roomType === 'group' && (
            <div style={styles.memberCount}>
              {room.members.length} member{room.members.length !== 1 ? 's' : ''}
            </div>
          )}
          <div style={styles.roomPreview}>
            <span style={styles.previewText}>
              {room.lastMessage
                ? truncate(room.lastMessage.body, 40)
                : 'No messages yet'}
            </span>
            {unread > 0 && (
              <span style={styles.unreadBadge}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons (star + archive) */}
        <div style={styles.actionButtons}>
          {/* Star button: always visible if starred, visible on hover otherwise */}
          <button
            type="button"
            style={{
              ...styles.starButton,
              ...(isStarred
                ? { color: '#d29922', opacity: 1 }
                : { opacity: isHovered ? 0.7 : 0 }),
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
      </button>
    );
  };

  return (
    <div style={styles.container}>
      {/* Search / filter bar */}
      <div style={styles.searchContainer}>
        <div style={styles.searchInputWrap}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="7" cy="7" r="5" stroke="#484f58" strokeWidth="1.5" fill="none" />
            <path d="M11 11l3.5 3.5" stroke="#484f58" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            style={styles.searchInput}
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search conversations"
          />
          {searchQuery && (
            <button
              type="button"
              style={styles.searchClear}
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
          <div style={styles.sectionHeader}>Starred</div>
          {starredRooms.map(renderRoomItem)}
        </>
      )}

      {/* All Conversations section */}
      {normalRooms.length > 0 && (
        <>
          <div style={styles.sectionHeader}>
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
            <span>{showArchived ? '\u25BC' : '\u25B6'}</span>
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
    transition: 'border-color 0.15s',
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
    color: '#484f58',
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
    color: '#8b949e',
  },
  emptyHint: {
    margin: '8px 0 0',
    fontSize: 12,
    color: '#484f58',
  },
  sectionHeader: {
    padding: '10px 16px 4px',
    fontSize: 11,
    fontWeight: 600,
    color: '#484f58',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
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
    transition: 'background-color 0.15s',
    fontFamily: 'inherit',
    borderLeft: '3px solid transparent',
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
    color: '#58a6ff',
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
    color: '#484f58',
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
    color: '#484f58',
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
    transition: 'opacity 0.15s, color 0.15s',
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
    color: '#484f58',
    fontFamily: 'inherit',
    width: '100%',
    textAlign: 'left',
    transition: 'color 0.15s',
  },
};

export default RoomList;
