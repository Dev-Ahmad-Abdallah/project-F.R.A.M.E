/**
 * RoomList — Sidebar list of conversations for F.R.A.M.E.
 *
 * Displays the user's rooms with room name, last message preview,
 * and unread indicator. Highlights the currently selected room.
 * All rendered content is sanitized via DOMPurify.
 */

import React, { useState } from 'react';
import DOMPurify from 'dompurify';
import type { RoomSummary } from '../api/roomsAPI';

// ── Types ──

interface RoomListProps {
  rooms: RoomSummary[];
  selectedRoomId: string | null;
  currentUserId: string;
  onSelectRoom: (roomId: string) => void;
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
    return DOMPurify.sanitize(room.name);
  }

  if (room.roomType === 'direct') {
    const other = room.members.find((m) => m.userId !== currentUserId);
    if (other) {
      return DOMPurify.sanitize(other.displayName || other.userId);
    }
  }

  // Group fallback: list first 3 member names
  const names = room.members
    .filter((m) => m.userId !== currentUserId)
    .slice(0, 3)
    .map((m) => DOMPurify.sanitize(m.displayName || m.userId));

  if (names.length === 0) return 'Empty Room';
  return names.join(', ');
}

/**
 * Truncate a message preview to a reasonable length.
 */
function truncate(text: string, maxLength: number): string {
  const sanitized = DOMPurify.sanitize(text);
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
}) => {
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
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

  return (
    <div style={styles.container}>
      {rooms.map((room) => {
        const isSelected = room.roomId === selectedRoomId;
        const displayName = getRoomDisplayName(room, currentUserId);

        return (
          <button
            key={room.roomId}
            type="button"
            style={{
              ...styles.roomItem,
              ...(isSelected ? styles.roomItemSelected : {}),
              ...(hoveredRoomId === room.roomId && !isSelected ? { backgroundColor: '#161b22' } : {}),
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
                {room.unreadCount > 0 && (
                  <span style={styles.unreadBadge}>
                    {room.unreadCount > 99 ? '99+' : room.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
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
};

export default RoomList;
