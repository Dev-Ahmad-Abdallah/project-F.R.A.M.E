/**
 * NewChatDialog — Modal for creating a new conversation in F.R.A.M.E.
 *
 * Allows the user to enter a username to invite and select the room
 * type (Direct Message or Group). On success, notifies the parent
 * to add the new room and select it.
 *
 * All user input is sanitized before display. Uses DOMPurify.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { createRoom } from '../api/roomsAPI';
import type { RoomSummary } from '../api/roomsAPI';

// ── Types ──

interface NewChatDialogProps {
  currentUserId: string;
  onCreated: (room: RoomSummary) => void;
  onClose: () => void;
}

// ── Component ──

const NewChatDialog: React.FC<NewChatDialogProps> = ({
  currentUserId,
  onCreated,
  onClose,
}) => {
  const [username, setUsername] = useState('');
  const [roomType, setRoomType] = useState<'direct' | 'group'>('direct');
  const [roomName, setRoomName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Prevent background scrolling
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  const handleCreate = useCallback(async () => {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError('Please enter a username.');
      return;
    }

    // Prevent inviting yourself
    if (trimmedUsername === currentUserId) {
      setError('You cannot create a conversation with yourself.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await createRoom(
        roomType,
        [trimmedUsername],
        roomType === 'group' && roomName.trim()
          ? roomName.trim()
          : undefined,
      );

      // Build a local RoomSummary for immediate UI update
      const newRoom: RoomSummary = {
        roomId: result.roomId,
        roomType,
        name:
          roomType === 'group' && roomName.trim()
            ? roomName.trim()
            : undefined,
        members: [
          { userId: currentUserId },
          { userId: trimmedUsername },
        ],
        unreadCount: 0,
      };

      onCreated(newRoom);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create conversation.');
      }
    } finally {
      setLoading(false);
    }
  }, [username, roomType, roomName, currentUserId, onCreated]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div style={styles.overlay} onClick={handleOverlayClick}>
      <div
        style={styles.modal}
        role="dialog"
        aria-labelledby="new-chat-title"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div style={styles.header}>
          <h2 id="new-chat-title" style={styles.title}>
            New Conversation
          </h2>
          <button
            type="button"
            style={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            &#10005;
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={styles.error}>
            {DOMPurify.sanitize(error)}
          </div>
        )}

        {/* Room type selector */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Type</label>
          <div style={styles.typeSelector}>
            <button
              type="button"
              style={{
                ...styles.typeButton,
                ...(roomType === 'direct' ? styles.typeButtonActive : {}),
              }}
              onClick={() => setRoomType('direct')}
            >
              Direct Message
            </button>
            <button
              type="button"
              style={{
                ...styles.typeButton,
                ...(roomType === 'group' ? styles.typeButtonActive : {}),
              }}
              onClick={() => setRoomType('group')}
            >
              Group
            </button>
          </div>
        </div>

        {/* Room name (group only) */}
        {roomType === 'group' && (
          <div style={styles.fieldGroup}>
            <label style={styles.label} htmlFor="new-chat-room-name">
              Group Name (optional)
            </label>
            <input
              id="new-chat-room-name"
              type="text"
              style={styles.input}
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="e.g. Project Team"
              disabled={loading}
            />
          </div>
        )}

        {/* Username input */}
        <div style={styles.fieldGroup}>
          <label style={styles.label} htmlFor="new-chat-username">
            Username to invite
          </label>
          <input
            id="new-chat-username"
            ref={inputRef}
            type="text"
            style={styles.input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. @alice:frame.local"
            disabled={loading}
          />
        </div>

        {/* Actions */}
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.cancelButton}
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{
              ...styles.createButton,
              ...(loading || !username.trim() ? styles.buttonDisabled : {}),
            }}
            onClick={handleCreate}
            disabled={loading || !username.trim()}
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Styles (dark theme) ──

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9998,
    padding: 16,
  },
  modal: {
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 12,
    padding: 28,
    maxWidth: 440,
    width: '100%',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#c9d1d9',
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: '#f0f6fc',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#8b949e',
    fontSize: 18,
    cursor: 'pointer',
    padding: '4px 8px',
    lineHeight: 1,
  },
  error: {
    backgroundColor: '#3d1f28',
    border: '1px solid #6e3630',
    borderRadius: 6,
    padding: '8px 12px',
    marginBottom: 16,
    fontSize: 13,
    color: '#f85149',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: '#8b949e',
  },
  input: {
    padding: '8px 12px',
    fontSize: 14,
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 6,
    color: '#c9d1d9',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
    width: '100%',
  },
  typeSelector: {
    display: 'flex',
    gap: 8,
  },
  typeButton: {
    flex: 1,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 500,
    backgroundColor: '#21262d',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  typeButtonActive: {
    backgroundColor: '#1c2128',
    color: '#58a6ff',
    borderColor: '#58a6ff',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  cancelButton: {
    padding: '8px 18px',
    fontSize: 14,
    fontWeight: 500,
    backgroundColor: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  createButton: {
    padding: '8px 18px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
};

export default NewChatDialog;
