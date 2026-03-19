/**
 * NewChatDialog — Modal for creating a new conversation in F.R.A.M.E.
 *
 * Allows the user to enter a username to invite and select the room
 * type (Direct Message or Group). On success, notifies the parent
 * to add the new room and select it.
 *
 * All user input is sanitized before display. Uses DOMPurify.
 *
 * Enhancements:
 * - Smooth slide-up entrance animation (from bottom)
 * - Success state with checkmark animation on room creation
 * - Sliding pill indicator for type toggle
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
import { createRoom } from '../api/roomsAPI';
import type { RoomSummary } from '../api/roomsAPI';
import { FONT_BODY } from '../globalStyles';
import { useIsMobile } from '../hooks/useIsMobile';

// ── Types ──

interface NewChatDialogProps {
  currentUserId: string;
  onCreated: (room: RoomSummary) => void;
  onClose: () => void;
}

// ── Inject keyframes ──

function injectNewChatKeyframes(): void {
  const styleId = 'frame-newchat-keyframes';
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes frame-dialog-slide-up {
      0% {
        opacity: 0;
        transform: translateY(40px) scale(0.97);
      }
      100% {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
    @keyframes frame-dialog-slide-up-mobile {
      0% {
        transform: translateY(100%);
      }
      100% {
        transform: translateY(0);
      }
    }
    @keyframes frame-dialog-overlay-fade {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }
    @keyframes frame-success-checkmark {
      0% { transform: scale(0) rotate(-45deg); opacity: 0; }
      50% { transform: scale(1.2) rotate(0deg); opacity: 1; }
      100% { transform: scale(1) rotate(0deg); opacity: 1; }
    }
    @keyframes frame-success-ring {
      0% { transform: scale(0.5); opacity: 0; }
      50% { transform: scale(1.1); opacity: 0.8; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes frame-success-sparkle {
      0% { transform: scale(0) rotate(0deg); opacity: 1; }
      100% { transform: scale(1) rotate(180deg); opacity: 0; }
    }
    @keyframes frame-pill-slide {
      0% { transform: translateX(var(--pill-from, 0)); }
      100% { transform: translateX(var(--pill-to, 0)); }
    }
  `;
  document.head.appendChild(style);
}

// ── Component ──

// ── Helpers ──

const AVATAR_COLORS = ['#da3633', '#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f78166'];

function getAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function extractShortName(userId: string): string {
  // "@alice:server" → "alice"
  const match = userId.match(/^@([^:]+)/);
  return match ? match[1] : userId;
}

const NewChatDialog: React.FC<NewChatDialogProps> = ({
  currentUserId,
  onCreated,
  onClose,
}) => {
  const isMobile = useIsMobile();
  const isNarrow = useIsMobile(400);
  const [username, setUsername] = useState('');
  const [roomType, setRoomType] = useState<'direct' | 'group'>('direct');
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [successRoom, setSuccessRoom] = useState<RoomSummary | null>(null);
  // Multi-user chips for group mode
  const [invitedUsers, setInvitedUsers] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const typeSelectorRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Inject animation keyframes
  useEffect(() => {
    injectNewChatKeyframes();
  }, []);

  // Capture the trigger element and auto-focus the input on mount
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement;
    inputRef.current?.focus();
    return () => {
      // Return focus to trigger on unmount
      triggerRef.current?.focus();
    };
  }, []);

  // Focus trap: keep Tab cycling within the modal
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    const handleFocusTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleFocusTrap);
    return () => document.removeEventListener('keydown', handleFocusTrap);
  }, [showSuccess]);

  // Prevent background scrolling
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Add a user chip (group mode)
  const handleAddUser = useCallback(() => {
    const trimmed = username.trim();
    if (!trimmed) return;
    if (trimmed === currentUserId) {
      setError('You cannot invite yourself.');
      return;
    }
    if (invitedUsers.includes(trimmed)) {
      setError('User already added.');
      return;
    }
    setInvitedUsers((prev) => [...prev, trimmed]);
    setUsername('');
    setError(null);
    inputRef.current?.focus();
  }, [username, currentUserId, invitedUsers]);

  // Remove a user chip
  const handleRemoveUser = useCallback((userId: string) => {
    setInvitedUsers((prev) => prev.filter((u) => u !== userId));
  }, []);

  // Compute default group name suggestion
  const groupNameSuggestion = invitedUsers.length > 0
    ? `Group with ${invitedUsers.map(extractShortName).join(', ')}`
    : 'Group chat';

  const handleCreate = useCallback(async () => {
    if (roomType === 'group') {
      // Group mode: use chips
      if (invitedUsers.length === 0) {
        setError('Please add at least one user to the group.');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const finalName = roomName.trim() || groupNameSuggestion;
        const result = await createRoom(
          roomType,
          invitedUsers,
          finalName,
          {
            isPrivate: isPrivate || undefined,
            password: roomPassword.trim() || undefined,
          },
        );

        const newRoom: RoomSummary = {
          roomId: result.roomId,
          roomType,
          name: finalName,
          members: [
            { userId: currentUserId },
            ...invitedUsers.map((u) => ({ userId: u })),
          ],
          unreadCount: 0,
        };

        setSuccessRoom(newRoom);
        setShowSuccess(true);
        setTimeout(() => {
          onCreated(newRoom);
        }, 1200);
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to create conversation.');
        }
      } finally {
        setLoading(false);
      }
    } else {
      // Direct mode: single user
      const trimmedUsername = username.trim();
      if (!trimmedUsername) {
        setError('Please enter a username.');
        return;
      }

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
          undefined,
          {
            isPrivate: isPrivate || undefined,
            password: roomPassword.trim() || undefined,
          },
        );

        const newRoom: RoomSummary = {
          roomId: result.roomId,
          roomType,
          name: undefined,
          members: [
            { userId: currentUserId },
            { userId: trimmedUsername },
          ],
          unreadCount: 0,
        };

        setSuccessRoom(newRoom);
        setShowSuccess(true);
        setTimeout(() => {
          onCreated(newRoom);
        }, 1200);
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to create conversation.');
        }
      } finally {
        setLoading(false);
      }
    }
  }, [username, roomType, roomName, isPrivate, roomPassword, currentUserId, onCreated, invitedUsers, groupNameSuggestion]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (roomType === 'group' && username.trim()) {
        // In group mode, Enter adds to chips instead of creating
        handleAddUser();
      } else {
        void handleCreate();
      }
    }
    if (e.key === 'Backspace' && roomType === 'group' && username === '' && invitedUsers.length > 0) {
      // Remove last chip on backspace when input is empty
      setInvitedUsers((prev) => prev.slice(0, -1));
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

  // Success state overlay
  if (showSuccess) {
    return (
      <div style={{
        ...styles.overlay,
        animation: 'frame-dialog-overlay-fade 0.2s ease-out',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column' as const,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
        }}>
          {/* Success ring */}
          <div style={{
            position: 'relative' as const,
            width: 80,
            height: 80,
          }}>
            {/* Outer ring */}
            <div style={{
              position: 'absolute' as const,
              top: 0,
              left: 0,
              width: 80,
              height: 80,
              borderRadius: '50%',
              border: '3px solid #3fb950',
              animation: 'frame-success-ring 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            }} />
            {/* Checkmark */}
            <svg width="80" height="80" viewBox="0 0 80 80" style={{
              position: 'absolute' as const,
              top: 0,
              left: 0,
              animation: 'frame-success-checkmark 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.2s both',
            }}>
              <path d="M24 40l10 10 22-22" stroke="#3fb950" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            {/* Sparkle particles */}
            {[0, 60, 120, 180, 240, 300].map((angle, i) => (
              <div key={i} style={{
                position: 'absolute' as const,
                top: 40 + Math.sin(angle * Math.PI / 180) * 50 - 3,
                left: 40 + Math.cos(angle * Math.PI / 180) * 50 - 3,
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: i % 2 === 0 ? '#58a6ff' : '#3fb950',
                animation: `frame-success-sparkle 0.8s ease-out ${0.3 + i * 0.05}s both`,
              }} />
            ))}
          </div>
          <p style={{
            color: '#e6edf3',
            fontSize: 16,
            fontWeight: 600,
            margin: 0,
            animation: 'frame-dialog-slide-up 0.4s ease-out 0.3s both',
          }}>
            Conversation created!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      ...styles.overlay,
      ...(isMobile ? { padding: 0, alignItems: 'flex-end' } : {}),
      animation: 'frame-dialog-overlay-fade 0.2s ease-out',
    }} onClick={handleOverlayClick}>
      <div
        ref={modalRef}
        style={{
          ...styles.modal,
          animation: isMobile
            ? 'frame-dialog-slide-up-mobile 0.35s cubic-bezier(0.16, 1, 0.3, 1)'
            : 'frame-dialog-slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
          ...(isMobile ? {
            maxWidth: '100%',
            width: '100%',
            maxHeight: '92vh',
            borderRadius: '16px 16px 0 0',
            border: 'none',
            borderTop: '1px solid #30363d',
            padding: '16px 20px 24px',
            display: 'flex',
            flexDirection: 'column' as const,
            overflowY: 'auto' as const,
          } : {}),
        }}
        role="dialog"
        aria-modal="true"
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
            {DOMPurify.sanitize(error, PURIFY_CONFIG)}
          </div>
        )}

        {/* Room type selector with sliding pill */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Type</label>
          <div
            ref={typeSelectorRef}
            style={{
              ...styles.typeSelector,
              ...(isNarrow ? { flexDirection: 'column' as const } : {}),
              position: 'relative' as const,
            }}
          >
            {/* Sliding pill background */}
            {!isNarrow && (
              <div style={{
                position: 'absolute' as const,
                top: 0,
                left: roomType === 'direct' ? 0 : 'calc(50% + 4px)',
                width: 'calc(50% - 4px)',
                height: '100%',
                backgroundColor: 'rgba(88, 166, 255, 0.1)',
                border: '1px solid #58a6ff',
                borderRadius: 6,
                transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                pointerEvents: 'none' as const,
                zIndex: 0,
              }} />
            )}
            <button
              type="button"
              style={{
                ...styles.typeButton,
                ...(roomType === 'direct' ? styles.typeButtonActive : {}),
                position: 'relative' as const,
                zIndex: 1,
                border: isNarrow ? (roomType === 'direct' ? '1px solid #58a6ff' : '1px solid #30363d') : '1px solid transparent',
                backgroundColor: isNarrow
                  ? (roomType === 'direct' ? 'rgba(88, 166, 255, 0.1)' : '#21262d')
                  : 'transparent',
                transition: 'color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease',
              }}
              aria-pressed={roomType === 'direct'}
              onClick={() => setRoomType('direct')}
            >
              Direct Message
            </button>
            <button
              type="button"
              style={{
                ...styles.typeButton,
                ...(roomType === 'group' ? styles.typeButtonActive : {}),
                position: 'relative' as const,
                zIndex: 1,
                border: isNarrow ? (roomType === 'group' ? '1px solid #58a6ff' : '1px solid #30363d') : '1px solid transparent',
                backgroundColor: isNarrow
                  ? (roomType === 'group' ? 'rgba(88, 166, 255, 0.1)' : '#21262d')
                  : 'transparent',
                transition: 'color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease',
              }}
              aria-pressed={roomType === 'group'}
              onClick={() => setRoomType('group')}
            >
              Group
            </button>
          </div>
          <p style={styles.typeHint}>
            {roomType === 'direct'
              ? 'Direct: private 1:1 conversation'
              : 'Group: invite multiple people'}
          </p>
        </div>

        {/* Group name (always visible in group mode) */}
        {roomType === 'group' && (
          <div style={styles.fieldGroup}>
            <label style={styles.label} htmlFor="new-chat-room-name">
              Group Name
            </label>
            <input
              id="new-chat-room-name"
              type="text"
              style={styles.input}
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder={groupNameSuggestion}
              disabled={loading}
            />
            <span style={styles.fieldHint}>
              {roomName.trim() ? '' : `Defaults to "${groupNameSuggestion}"`}
            </span>
          </div>
        )}

        {/* Private room toggle (group only) */}
        {roomType === 'group' && (
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Access Control</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                style={{
                  ...styles.toggleButton,
                  ...(isPrivate ? styles.toggleButtonActive : {}),
                  transition: 'all 0.2s ease',
                }}
                onClick={() => setIsPrivate(!isPrivate)}
                disabled={loading}
              >
                {isPrivate ? 'Private' : 'Open'}
              </button>
              <span style={styles.fieldHint}>
                {isPrivate ? 'Invite-only room' : 'Anyone can join'}
              </span>
            </div>
          </div>
        )}

        {/* Room password (group only) */}
        {roomType === 'group' && (
          <div style={styles.fieldGroup}>
            <label style={styles.label} htmlFor="new-chat-password">
              Room Password (optional)
            </label>
            <input
              id="new-chat-password"
              type="password"
              style={styles.input}
              value={roomPassword}
              onChange={(e) => setRoomPassword(e.target.value)}
              placeholder="Leave blank for no password"
              disabled={loading}
            />
            <span style={styles.fieldHint}>
              Users will need this password to join
            </span>
          </div>
        )}

        {/* Username input */}
        <div style={styles.fieldGroup}>
          <label style={styles.label} htmlFor="new-chat-username">
            {roomType === 'group' ? 'Add members' : 'Username to invite'}
          </label>

          {/* Chips for group mode */}
          {roomType === 'group' && invitedUsers.length > 0 && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap' as const,
              gap: 6,
              marginBottom: 4,
            }}>
              {invitedUsers.map((userId) => (
                <div
                  key={userId}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px 4px 4px',
                    borderRadius: 16,
                    backgroundColor: 'rgba(88, 166, 255, 0.1)',
                    border: '1px solid rgba(88, 166, 255, 0.3)',
                    fontSize: 12,
                    color: '#c9d1d9',
                    animation: 'frame-dialog-slide-up 0.2s ease-out',
                  }}
                >
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    backgroundColor: getAvatarColor(userId),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                    flexShrink: 0,
                  }}>
                    {extractShortName(userId).charAt(0).toUpperCase()}
                  </div>
                  <span>{DOMPurify.sanitize(extractShortName(userId), PURIFY_CONFIG)}</span>
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#8b949e',
                      fontSize: 14,
                      cursor: 'pointer',
                      padding: '0 2px',
                      lineHeight: 1,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onClick={() => handleRemoveUser(userId)}
                    title={`Remove ${extractShortName(userId)}`}
                    aria-label={`Remove ${extractShortName(userId)}`}
                  >
                    &#10005;
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ ...styles.inputWrapper, flex: 1 }}>
              <input
                id="new-chat-username"
                ref={inputRef}
                type="text"
                style={{
                  ...styles.input,
                  ...(username.trim() && /^@[^:]+:.+$/.test(username.trim())
                    ? styles.inputValid
                    : {}),
                  transition: 'border-color 0.2s ease',
                }}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. @alice:frame.local"
                disabled={loading}
              />
              {username.trim() && /^@[^:]+:.+$/.test(username.trim()) && (
                <span style={styles.validIcon} title="Valid username format">
                  &#10003;
                </span>
              )}
            </div>
            {roomType === 'group' && (
              <button
                type="button"
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  backgroundColor: username.trim() ? 'rgba(88, 166, 255, 0.15)' : '#21262d',
                  color: username.trim() ? '#58a6ff' : '#8b949e',
                  border: `1px solid ${username.trim() ? 'rgba(88, 166, 255, 0.4)' : '#30363d'}`,
                  borderRadius: 6,
                  cursor: username.trim() ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                  minHeight: 36,
                }}
                onClick={handleAddUser}
                disabled={!username.trim() || loading}
              >
                Add
              </button>
            )}
          </div>
          <span style={styles.fieldHint}>
            {roomType === 'group'
              ? (username.trim().length === 0
                  ? 'Format: @user:server \u2014 press Enter or Add to include'
                  : /^@[^:]+:.+$/.test(username.trim())
                    ? 'Press Enter to add this user'
                    : 'Expected format: @user:server')
              : (username.trim().length === 0
                  ? 'Format: @user:server'
                  : /^@[^:]+:.+$/.test(username.trim())
                    ? 'Valid username format'
                    : 'Expected format: @user:server')
            }
          </span>
        </div>

        {/* Actions */}
        <div style={styles.actions}>
          <button
            type="button"
            style={{
              ...styles.cancelButton,
              transition: 'background-color 0.15s ease, border-color 0.15s ease',
            }}
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{
              ...styles.createButton,
              ...(loading || (roomType === 'group' ? invitedUsers.length === 0 : !username.trim())
                ? styles.buttonDisabled
                : {}),
              transition: 'background-color 0.15s ease, opacity 0.15s ease, transform 0.1s ease',
            }}
            onClick={() => void handleCreate()}
            disabled={loading || (roomType === 'group' ? invitedUsers.length === 0 : !username.trim())}
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
    fontFamily: FONT_BODY,
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
    transition: 'color 0.15s ease',
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
    backgroundColor: '#21262d',
    borderRadius: 6,
    padding: 4,
  },
  typeButton: {
    flex: 1,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 500,
    backgroundColor: 'transparent',
    color: '#8b949e',
    border: '1px solid transparent',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 44,
  },
  typeButtonActive: {
    color: '#58a6ff',
  },
  typeHint: {
    margin: '4px 0 0',
    fontSize: 12,
    color: '#8b949e',
    fontStyle: 'italic',
  },
  inputWrapper: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
  },
  inputValid: {
    borderColor: '#238636',
  },
  validIcon: {
    position: 'absolute' as const,
    right: 10,
    color: '#3fb950',
    fontSize: 14,
    fontWeight: 700,
    pointerEvents: 'none' as const,
  },
  fieldHint: {
    fontSize: 11,
    color: '#8b949e',
    marginTop: 2,
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  cancelButton: {
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 500,
    backgroundColor: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 44,
  },
  createButton: {
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 44,
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  toggleButton: {
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    backgroundColor: '#21262d',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 20,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minWidth: 70,
  },
  toggleButtonActive: {
    backgroundColor: 'rgba(35, 134, 54, 0.15)',
    color: '#3fb950',
    borderColor: '#238636',
  },
};

export default NewChatDialog;
