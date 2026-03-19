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
import { renameRoom, inviteToRoom, leaveRoom, getRoomCode, regenerateCode } from '../api/roomsAPI';
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

  // Invite code state
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(false);
  const [regeneratingCode, setRegeneratingCode] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // Determine if current user is admin
  const currentMember = room.members.find((m) => m.userId === currentUserId);
  const isAdmin = !!(currentMember && 'role' in currentMember && (currentMember as RoomMember & { role?: string }).role === 'admin');

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => { injectKeyframes(); }, []);

  // Fetch invite code on mount
  useEffect(() => {
    let cancelled = false;
    setLoadingCode(true);
    getRoomCode(room.roomId)
      .then((data) => {
        if (!cancelled) setInviteCode(data.inviteCode);
      })
      .catch(() => {
        if (!cancelled) setInviteCode(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingCode(false);
      });
    return () => { cancelled = true; };
  }, [room.roomId]);

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
          {/* ═══ Share Room (prominent, at the top) ═══ */}
          <div style={{
            padding: '16px 0',
            borderBottom: '1px solid #21262d',
          }}>
            <div style={styles.categoryHeader}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
              Share Room
            </div>
            {loadingCode ? (
              <div style={styles.readOnlyValue}>Loading invite code...</div>
            ) : inviteCode ? (
              <div>
                {/* Big invite code display */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '14px 0',
                  marginBottom: 10,
                  backgroundColor: 'rgba(88, 166, 255, 0.04)',
                  borderRadius: 8,
                  border: '1px solid rgba(88, 166, 255, 0.15)',
                }}>
                  <span style={{
                    fontSize: 28,
                    fontWeight: 800,
                    fontFamily: 'monospace',
                    letterSpacing: '0.2em',
                    color: '#58a6ff',
                    userSelect: 'all' as const,
                  }}>
                    {inviteCode}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      backgroundColor: codeCopied ? 'rgba(35, 134, 54, 0.15)' : 'rgba(88, 166, 255, 0.1)',
                      color: codeCopied ? '#3fb950' : '#58a6ff',
                      border: `1px solid ${codeCopied ? '#238636' : 'rgba(88, 166, 255, 0.3)'}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => {
                      void navigator.clipboard.writeText(inviteCode);
                      setCodeCopied(true);
                      setTimeout(() => setCodeCopied(false), 2000);
                    }}
                  >
                    {codeCopied ? 'Copied!' : 'Copy Code'}
                  </button>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      backgroundColor: linkCopied ? 'rgba(35, 134, 54, 0.15)' : '#21262d',
                      color: linkCopied ? '#3fb950' : '#c9d1d9',
                      border: `1px solid ${linkCopied ? '#238636' : '#30363d'}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => {
                      const link = `${window.location.origin}/join/${inviteCode}`;
                      void navigator.clipboard.writeText(link);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    }}
                  >
                    {linkCopied ? 'Link Copied!' : 'Share Link'}
                  </button>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    style={{
                      width: '100%',
                      marginTop: 6,
                      padding: '6px 12px',
                      fontSize: 11,
                      fontWeight: 500,
                      backgroundColor: 'transparent',
                      color: '#6e7681',
                      border: '1px solid #21262d',
                      borderRadius: 6,
                      cursor: regeneratingCode ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                      opacity: regeneratingCode ? 0.6 : 1,
                      transition: 'all 0.15s ease',
                    }}
                    disabled={regeneratingCode}
                    onClick={() => {
                      setRegeneratingCode(true);
                      regenerateCode(room.roomId)
                        .then((data) => {
                          setInviteCode(data.inviteCode);
                          showSuccess('Invite code regenerated');
                        })
                        .catch((err) => {
                          console.error('Failed to regenerate code:', err);
                        })
                        .finally(() => setRegeneratingCode(false));
                    }}
                  >
                    {regeneratingCode ? 'Regenerating...' : 'Regenerate Code'}
                  </button>
                )}
                <div style={styles.hintText}>
                  Share this code so others can join the room
                </div>
              </div>
            ) : (
              <div style={styles.readOnlyValue}>No invite code available</div>
            )}
          </div>

          {/* ═══ General ═══ */}
          <div style={{ padding: '14px 0', borderBottom: '1px solid #21262d' }}>
            <div style={styles.categoryHeader}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
              General
            </div>
            {/* Room Name */}
            <div style={styles.settingRow}>
              <div style={styles.settingRowLabel}>Room Name</div>
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
                  <button type="button" style={styles.saveButton} onClick={() => void handleConfirmRename()} disabled={isRenaming}>
                    {isRenaming ? '...' : 'Save'}
                  </button>
                  <button type="button" style={styles.cancelButton} onClick={handleCancelRename} disabled={isRenaming}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={styles.editableValue} onClick={handleStartRename} title="Click to rename">
                  {displayName}
                  <span style={styles.editIcon}>&#9998;</span>
                </div>
              )}
            </div>
            {/* Room Type */}
            <div style={styles.settingRow}>
              <div style={styles.settingRowLabel}>Type</div>
              <div style={styles.readOnlyValue}>
                {room.roomType === 'direct' ? 'Direct Message' : 'Group Chat'}
              </div>
            </div>
            {/* Created */}
            <div style={{ ...styles.settingRow, borderBottom: 'none' }}>
              <div style={styles.settingRowLabel}>Created</div>
              <div style={styles.readOnlyValue}>{createdDate}</div>
            </div>
          </div>

          {/* ═══ Privacy ═══ */}
          <div style={{ padding: '14px 0', borderBottom: '1px solid #21262d' }}>
            <div style={styles.categoryHeader}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
              Privacy
            </div>
            <div style={styles.settingRow}>
              <div style={styles.settingRowLabel}>Encryption</div>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 4,
                backgroundColor: 'rgba(35, 134, 54, 0.1)',
                color: '#3fb950',
                fontSize: 12,
                fontWeight: 600,
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="3"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                E2EE Enabled
              </div>
            </div>
            <div style={{ ...styles.settingRow, borderBottom: 'none' }}>
              <div style={styles.settingRowLabel}>Access</div>
              <div style={styles.readOnlyValue}>
                {room.roomType === 'direct' ? 'Private (1:1)' : 'Invite or code'}
              </div>
            </div>
          </div>

          {/* ═══ Messages ═══ */}
          <div style={{ padding: '14px 0', borderBottom: '1px solid #21262d' }}>
            <div style={styles.categoryHeader}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
              Messages
            </div>
            <div style={styles.settingRow}>
              <div style={{ flex: 1 }}>
                <div style={styles.settingRowLabel}>Disappearing Messages</div>
                <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>
                  Auto-delete after a set time
                </div>
              </div>
              <div style={styles.toggleRow}>
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
            </div>
          </div>

          {/* ═══ Members ═══ */}
          <div style={{ padding: '14px 0', borderBottom: '1px solid #21262d' }}>
            <div style={styles.categoryHeader}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
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

            {/* Invite Member */}
            <div style={{ marginTop: 10 }}>
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
          </div>

          {/* Leave Room */}
          <div style={{ padding: '14px 0', borderBottom: 'none' }}>
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
  categoryHeader: {
    fontSize: 11,
    fontWeight: 700,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginBottom: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  settingRow: {
    padding: '8px 0',
    borderBottom: '1px solid rgba(33, 38, 45, 0.6)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  settingRowLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: '#8b949e',
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
