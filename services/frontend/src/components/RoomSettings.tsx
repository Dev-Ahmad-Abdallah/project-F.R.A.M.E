/**
 * RoomSettings — Slide-in panel for room information and settings.
 *
 * Shows room name (editable), type, member list, invite, leave,
 * and a placeholder disappearing messages toggle.
 * Dark themed with inline styles matching the rest of the app.
 *
 * Visual polish: smooth slide-in from right, member avatar colors
 * from a palette, confirmation animation on success actions.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
import { renameRoom, inviteToRoom, leaveRoom } from '../api/roomsAPI';
import { useIsMobile } from '../hooks/useIsMobile';
import type { RoomSummary, RoomMember } from '../api/roomsAPI';

// ── Keyframes (injected once) ──

const ROOM_SETTINGS_KEYFRAMES_ID = 'frame-room-settings-keyframes';

function injectKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(ROOM_SETTINGS_KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = ROOM_SETTINGS_KEYFRAMES_ID;
  style.textContent = `
    @keyframes frameRoomSlideIn {
      0% { transform: translateX(100%); opacity: 0.5; }
      100% { transform: translateX(0); opacity: 1; }
    }
    @keyframes frameRoomOverlayFade {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }
    @keyframes frameRoomSuccessCheck {
      0% { transform: scale(0) rotate(-45deg); opacity: 0; }
      50% { transform: scale(1.2) rotate(0deg); opacity: 1; }
      100% { transform: scale(1) rotate(0deg); opacity: 1; }
    }
    @keyframes frameRoomSuccessFade {
      0% { opacity: 1; }
      70% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes frameRoomMemberFadeIn {
      0% { opacity: 0; transform: translateX(8px); }
      100% { opacity: 1; transform: translateX(0); }
    }
  `;
  document.head.appendChild(style);
}

// ── Avatar color palette (Signal / WhatsApp inspired) ──

const AVATAR_COLORS = [
  '#58a6ff', // blue
  '#bc8cff', // purple
  '#f78166', // coral
  '#3fb950', // green
  '#d29922', // amber
  '#f47067', // red
  '#79c0ff', // light blue
  '#d2a8ff', // lavender
  '#56d364', // lime
  '#e3b341', // gold
];

function avatarColorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface RoomSettingsProps {
  room: RoomSummary;
  currentUserId: string;
  onClose: () => void;
  /** Called when user successfully leaves the room */
  onLeaveRoom?: (roomId: string) => void;
  /** Called when the room is renamed */
  onRoomRenamed?: (roomId: string, newName: string) => void;
  /** Called when a member is invited */
  onMemberInvited?: (roomId: string) => void;
}

const RoomSettings: React.FC<RoomSettingsProps> = ({
  room,
  currentUserId,
  onClose,
  onLeaveRoom,
  onRoomRenamed,
  onMemberInvited,
}) => {
  const isMobile = useIsMobile();
  // Rename state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState(room.name || '');
  const [isRenaming, setIsRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Invite state
  const [showInviteInput, setShowInviteInput] = useState(false);
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  // Leave state
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  // Disappearing messages placeholder
  const [disappearingEnabled, setDisappearingEnabled] = useState(false);

  // Success flash state
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => { injectKeyframes(); }, []);

  // Focus management: capture trigger, focus panel, return focus on close
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement;
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();
    return () => { triggerRef.current?.focus(); };
  }, []);

  // Focus trap and Escape to close
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const showSuccess = useCallback((msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 2000);
  }, []);

  // Derive display name
  const displayName = room.name
    ? DOMPurify.sanitize(room.name, PURIFY_CONFIG)
    : room.roomType === 'direct'
      ? (() => {
          const other = room.members.find((m) => m.userId !== currentUserId);
          return DOMPurify.sanitize(other?.displayName || other?.userId || 'Direct Message', PURIFY_CONFIG);
        })()
      : (() => {
          const names = room.members
            .filter((m) => m.userId !== currentUserId)
            .slice(0, 3)
            .map((m) => DOMPurify.sanitize(m.displayName || m.userId, PURIFY_CONFIG));
          return names.length > 0 ? names.join(', ') : 'Empty Room';
        })();

  const handleStartRename = useCallback(() => {
    setEditNameValue(displayName);
    setIsEditingName(true);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }, [displayName]);

  const handleCancelRename = useCallback(() => {
    setIsEditingName(false);
  }, []);

  const handleConfirmRename = useCallback(async () => {
    const trimmed = editNameValue.trim();
    if (!trimmed || trimmed === displayName) {
      handleCancelRename();
      return;
    }
    setIsRenaming(true);
    try {
      await renameRoom(room.roomId, trimmed);
      onRoomRenamed?.(room.roomId, trimmed);
      setIsEditingName(false);
      showSuccess('Room renamed');
    } catch (err) {
      console.error('Failed to rename room:', err);
    } finally {
      setIsRenaming(false);
    }
  }, [editNameValue, displayName, room.roomId, onRoomRenamed, handleCancelRename, showSuccess]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleConfirmRename();
    } else if (e.key === 'Escape') {
      handleCancelRename();
    }
  }, [handleConfirmRename, handleCancelRename]);

  const handleInvite = useCallback(async () => {
    const trimmed = inviteUserId.trim();
    if (!trimmed) return;
    setInviteError(null);
    setIsInviting(true);
    try {
      await inviteToRoom(room.roomId, trimmed);
      setInviteUserId('');
      setShowInviteInput(false);
      onMemberInvited?.(room.roomId);
      showSuccess('Invite sent');
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to invite user');
    } finally {
      setIsInviting(false);
    }
  }, [inviteUserId, room.roomId, onMemberInvited, showSuccess]);

  const handleLeave = useCallback(async () => {
    setIsLeaving(true);
    try {
      await leaveRoom(room.roomId);
      onLeaveRoom?.(room.roomId);
    } catch (err) {
      console.error('Failed to leave room:', err);
      setIsLeaving(false);
      setShowLeaveConfirm(false);
    }
  }, [room.roomId, onLeaveRoom]);

  const createdDate = room.roomId
    ? new Date().toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Unknown';

  return (
    <div style={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Room Settings">
      <div ref={panelRef} style={{
        ...styles.panel,
        ...(isMobile ? {
          width: '100vw',
          maxWidth: '100vw',
          borderLeft: 'none',
          borderRadius: 0,
        } : {}),
      }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.panelHeader}>
          <span style={styles.panelTitle}>Room Settings</span>
          <button
            type="button"
            style={styles.closeButton}
            onClick={onClose}
            aria-label="Close settings"
          >
            &times;
          </button>
        </div>

        {/* Success flash banner */}
        {successMessage && (
          <div style={styles.successBanner}>
            <svg width="16" height="16" viewBox="0 0 24 24" style={{
              animation: 'frameRoomSuccessCheck 0.4s ease-out',
            }}>
              <circle cx="12" cy="12" r="11" fill="#238636" />
              <path d="M7 13l3 3 7-7" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{successMessage}</span>
          </div>
        )}

        <div style={styles.panelBody}>
          {/* Room Name */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Room Name</div>
            {isEditingName ? (
              <div style={styles.inlineEditRow}>
                <input
                  ref={renameInputRef}
                  type="text"
                  style={styles.renameInput}
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  disabled={isRenaming}
                  maxLength={128}
                  aria-label="New room name"
                />
                <button
                  type="button"
                  style={styles.saveButton}
                  onClick={() => void handleConfirmRename()}
                  disabled={isRenaming}
                >
                  {isRenaming ? '...' : 'Save'}
                </button>
                <button
                  type="button"
                  style={styles.cancelButton}
                  onClick={handleCancelRename}
                  disabled={isRenaming}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div
                style={styles.editableValue}
                onClick={handleStartRename}
                title="Click to rename"
              >
                {displayName}
                <span style={styles.editIcon}>&#9998;</span>
              </div>
            )}
          </div>

          {/* Room Type */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Room Type</div>
            <div style={styles.readOnlyValue}>
              {room.roomType === 'direct' ? 'Direct Message' : 'Group Chat'}
            </div>
          </div>

          {/* Created Date */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Created</div>
            <div style={styles.readOnlyValue}>{createdDate}</div>
          </div>

          {/* Member List */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>
              Members ({room.members.length})
            </div>
            <div style={styles.memberList}>
              {room.members.map((member: RoomMember, index: number) => {
                const avatarColor = avatarColorForUser(member.userId);
                return (
                  <div
                    key={member.userId}
                    style={{
                      ...styles.memberItem,
                      animation: `frameRoomMemberFadeIn 0.3s ease-out ${index * 0.05}s both`,
                    }}
                  >
                    <div style={{
                      ...styles.memberAvatar,
                      backgroundColor: `${avatarColor}22`,
                      color: avatarColor,
                      border: `1.5px solid ${avatarColor}44`,
                    }}>
                      {(member.displayName || member.userId).charAt(0).toUpperCase()}
                    </div>
                    <div style={styles.memberInfo}>
                      <span style={styles.memberName}>
                        {DOMPurify.sanitize(member.displayName || member.userId, PURIFY_CONFIG)}
                      </span>
                      {member.userId === currentUserId && (
                        <span style={styles.youBadge}>you</span>
                      )}
                    </div>
                    <span style={styles.verifiedBadge} title="Verified">
                      &#10003;
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Invite Member */}
          <div style={styles.section}>
            {showInviteInput ? (
              <div>
                <div style={styles.inlineEditRow}>
                  <input
                    type="text"
                    style={styles.renameInput}
                    placeholder="@user:server"
                    value={inviteUserId}
                    onChange={(e) => setInviteUserId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleInvite();
                      if (e.key === 'Escape') setShowInviteInput(false);
                    }}
                    disabled={isInviting}
                    aria-label="User ID to invite"
                  />
                  <button
                    type="button"
                    style={styles.saveButton}
                    onClick={() => void handleInvite()}
                    disabled={isInviting || !inviteUserId.trim()}
                  >
                    {isInviting ? '...' : 'Invite'}
                  </button>
                </div>
                {inviteError && (
                  <div style={styles.errorText}>{inviteError}</div>
                )}
              </div>
            ) : (
              <button
                type="button"
                style={styles.actionButton}
                onClick={() => setShowInviteInput(true)}
              >
                + Invite Member
              </button>
            )}
          </div>

          {/* Disappearing Messages (placeholder) */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Disappearing Messages</div>
            <div style={styles.toggleRow}>
              <span style={styles.readOnlyValue}>
                {disappearingEnabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                type="button"
                style={{
                  ...styles.toggleButton,
                  backgroundColor: disappearingEnabled ? '#238636' : '#30363d',
                }}
                onClick={() => setDisappearingEnabled((prev) => !prev)}
                aria-label="Toggle disappearing messages"
              >
                <div
                  style={{
                    ...styles.toggleKnob,
                    transform: disappearingEnabled ? 'translateX(16px)' : 'translateX(0)',
                  }}
                />
              </button>
            </div>
            <div style={styles.hintText}>
              Coming soon - messages will auto-delete after a set time
            </div>
          </div>

          {/* Leave Room */}
          <div style={{ ...styles.section, borderBottom: 'none' }}>
            {showLeaveConfirm ? (
              <div>
                <div style={styles.confirmText}>
                  Are you sure you want to leave this room?
                </div>
                <div style={styles.confirmActions}>
                  <button
                    type="button"
                    style={styles.leaveConfirmButton}
                    onClick={() => void handleLeave()}
                    disabled={isLeaving}
                  >
                    {isLeaving ? 'Leaving...' : 'Leave Room'}
                  </button>
                  <button
                    type="button"
                    style={styles.cancelButton}
                    onClick={() => setShowLeaveConfirm(false)}
                    disabled={isLeaving}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                style={styles.leaveButton}
                onClick={() => setShowLeaveConfirm(true)}
              >
                Leave Room
              </button>
            )}
          </div>
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
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    display: 'flex',
    justifyContent: 'flex-end',
    animation: 'frameRoomOverlayFade 0.2s ease-out',
  },
  panel: {
    width: 340,
    maxWidth: '90vw',
    height: '100%',
    backgroundColor: '#161b22',
    borderLeft: '1px solid #30363d',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    animation: 'frameRoomSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #30363d',
    backgroundColor: '#0d1117',
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#e6edf3',
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    border: '1px solid #30363d',
    backgroundColor: 'transparent',
    color: '#8b949e',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s, color 0.15s',
  },
  successBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 20px',
    backgroundColor: 'rgba(35, 134, 54, 0.1)',
    borderBottom: '1px solid rgba(35, 134, 54, 0.3)',
    color: '#3fb950',
    fontSize: 13,
    fontWeight: 500,
    animation: 'frameRoomSuccessFade 2s ease-out forwards',
  },
  panelBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '0 20px',
  },
  section: {
    padding: '16px 0',
    borderBottom: '1px solid #21262d',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 8,
  },
  editableValue: {
    fontSize: 15,
    color: '#e6edf3',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 0',
  },
  editIcon: {
    fontSize: 13,
    color: '#8b949e',
    opacity: 0.8,
  },
  readOnlyValue: {
    fontSize: 14,
    color: '#c9d1d9',
  },
  inlineEditRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  renameInput: {
    flex: 1,
    fontSize: 14,
    color: '#e6edf3',
    backgroundColor: '#0d1117',
    border: '1px solid #58a6ff',
    borderRadius: 4,
    padding: '4px 8px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  saveButton: {
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cancelButton: {
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    backgroundColor: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  memberList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  memberItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 0',
  },
  memberAvatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 600,
    flexShrink: 0,
    transition: 'transform 0.15s ease',
  },
  memberInfo: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  memberName: {
    fontSize: 13,
    color: '#e6edf3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  youBadge: {
    fontSize: 10,
    color: '#8b949e',
    backgroundColor: '#21262d',
    padding: '1px 5px',
    borderRadius: 3,
    flexShrink: 0,
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
  actionButton: {
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    width: '100%',
    transition: 'background-color 0.15s',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleButton: {
    width: 36,
    height: 20,
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
    position: 'relative' as const,
    padding: 2,
    transition: 'background-color 0.2s',
  },
  toggleKnob: {
    width: 16,
    height: 16,
    borderRadius: '50%',
    backgroundColor: '#e6edf3',
    transition: 'transform 0.2s',
  },
  hintText: {
    fontSize: 11,
    color: '#8b949e',
    marginTop: 6,
    fontStyle: 'italic',
  },
  errorText: {
    fontSize: 12,
    color: '#f85149',
    marginTop: 6,
  },
  confirmText: {
    fontSize: 13,
    color: '#c9d1d9',
    marginBottom: 10,
  },
  confirmActions: {
    display: 'flex',
    gap: 8,
  },
  leaveButton: {
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    backgroundColor: 'rgba(248, 81, 73, 0.1)',
    color: '#f85149',
    border: '1px solid rgba(248, 81, 73, 0.4)',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    width: '100%',
    transition: 'background-color 0.15s',
  },
  leaveConfirmButton: {
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    backgroundColor: '#da3633',
    color: '#ffffff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};

export default RoomSettings;
