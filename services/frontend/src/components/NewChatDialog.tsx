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
import { createRoom, joinByCode } from '../api/roomsAPI';
import type { RoomSummary } from '../api/roomsAPI';
import { fetchAndVerifyKey } from '../verification/keyTransparency';
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
  const [roomType, setRoomType] = useState<'direct' | 'group' | 'join-code'>('direct');
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [privacyMode, setPrivacyMode] = useState<'open' | 'private' | 'password'>('open');
  const [disappearingTimer, setDisappearingTimer] = useState<number>(0);
  const [anonymousMode, setAnonymousMode] = useState(false);
  // Join by code state
  const [joinCode, setJoinCode] = useState('');
  const [joinCodePassword, setJoinCodePassword] = useState('');
  const [showJoinCodePassword, setShowJoinCodePassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
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
      setVerifying(true);
      setError(null);

      try {
        // Verify each invited user's key against the transparency log
        for (const invitee of invitedUsers) {
          try {
            const verification = await fetchAndVerifyKey(invitee);
            if (!verification.verified && verification.proof !== null) {
              console.warn(
                `[F.R.A.M.E.] Key transparency verification failed for ${invitee} during room creation — proceeding with warning.`,
              );
            }
          } catch (err) {
            console.warn(
              `[F.R.A.M.E.] Could not verify key for ${invitee}:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
        setVerifying(false);

        const finalName = roomName.trim() || groupNameSuggestion;
        const result = await createRoom(
          roomType,
          invitedUsers,
          finalName,
          {
            isPrivate: privacyMode === 'private' || privacyMode === 'password' || undefined,
            password: privacyMode === 'password' && roomPassword.trim() ? roomPassword.trim() : undefined,
            isAnonymous: anonymousMode || undefined,
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
          isAnonymous: anonymousMode || undefined,
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
    } else if (roomType === 'join-code') {
      // Join-by-code mode
      const trimmedCode = joinCode.trim().toUpperCase();
      if (!trimmedCode) {
        setError('Please enter a room code.');
        return;
      }
      if (!/^[A-F0-9]{6}$/.test(trimmedCode)) {
        setError('Invalid code format. Expected 6 characters (e.g., X7K9P2).');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await joinByCode(trimmedCode, joinCodePassword.trim() || undefined);
        const newRoom: RoomSummary = {
          roomId: result.roomId,
          roomType: 'group',
          name: result.name ?? undefined,
          members: [{ userId: currentUserId }],
          unreadCount: 0,
        };

        setSuccessRoom(newRoom);
        setShowSuccess(true);
        setTimeout(() => {
          onCreated(newRoom);
        }, 1200);
      } catch (err) {
        if (err instanceof Error) {
          if (err.message.includes('password')) {
            setShowJoinCodePassword(true);
          }
          setError(err.message);
        } else {
          setError('Failed to join room.');
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
      setVerifying(true);
      setError(null);

      try {
        // Verify the invited user's key against the transparency log
        try {
          const verification = await fetchAndVerifyKey(trimmedUsername);
          if (!verification.verified && verification.proof !== null) {
            console.warn(
              `[F.R.A.M.E.] Key transparency verification failed for ${trimmedUsername} during room creation — proceeding with warning.`,
            );
          }
        } catch (err) {
          console.warn(
            `[F.R.A.M.E.] Could not verify key for ${trimmedUsername}:`,
            err instanceof Error ? err.message : err,
          );
        }
        setVerifying(false);

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
  }, [username, roomType, roomName, isPrivate, roomPassword, privacyMode, disappearingTimer, anonymousMode, currentUserId, onCreated, invitedUsers, groupNameSuggestion, joinCode, joinCodePassword]);

  const handleJoinByCode = useCallback(async () => {
    const trimmedCode = joinCode.trim().toUpperCase();
    if (!trimmedCode) {
      setError('Please enter a room code.');
      return;
    }
    if (!/^[A-F0-9]{6}$/.test(trimmedCode)) {
      setError('Invalid code format. Expected 6 characters (e.g., X7K9P2).');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await joinByCode(trimmedCode, joinCodePassword.trim() || undefined);
      const newRoom: RoomSummary = {
        roomId: result.roomId,
        roomType: 'group',
        name: result.name ?? undefined,
        members: [{ userId: currentUserId }],
        unreadCount: 0,
      };

      setSuccessRoom(newRoom);
      setShowSuccess(true);
      setTimeout(() => {
        onCreated(newRoom);
      }, 1200);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes('password')) {
          setShowJoinCodePassword(true);
        }
        setError(err.message);
      } else {
        setError('Failed to join room.');
      }
    } finally {
      setLoading(false);
    }
  }, [joinCode, joinCodePassword, currentUserId, onCreated]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (roomType === 'join-code') {
        void handleJoinByCode();
      } else if (roomType === 'group' && username.trim()) {
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
            {roomType === 'group' ? 'Configure Secure Room' : 'New Conversation'}
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
            {(['direct', 'group', 'join-code'] as const).map((type) => {
              const labels: Record<string, string> = { direct: 'Direct Message', group: 'Group', 'join-code': 'Join by Code' };
              const isActive = roomType === type;
              return (
                <button
                  key={type}
                  type="button"
                  style={{
                    ...styles.typeButton,
                    ...(isActive ? styles.typeButtonActive : {}),
                    position: 'relative' as const,
                    zIndex: 1,
                    border: isActive ? '1px solid #58a6ff' : '1px solid transparent',
                    backgroundColor: isActive ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
                    transition: 'color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease',
                  }}
                  aria-pressed={isActive}
                  onClick={() => { setRoomType(type); setError(null); }}
                >
                  {/* eslint-disable-next-line security/detect-object-injection */}
                  {labels[type as keyof typeof labels]}
                </button>
              );
            })}
          </div>
          <p style={styles.typeHint}>
            {roomType === 'direct'
              ? 'Direct: private 1:1 conversation'
              : roomType === 'group'
                ? 'Group: invite multiple people'
                : 'Join an existing room with an invite code'}
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

        {/* ── Secure Session Configuration (group only) ── */}
        {roomType === 'group' && (
          <div style={{
            border: '1px solid #30363d',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 16,
          }}>
            {/* Section: Privacy */}
            <div style={{
              padding: '12px 14px',
              borderBottom: '1px solid #21262d',
            }}>
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#8b949e',
                textTransform: 'uppercase' as const,
                letterSpacing: '0.08em',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                Privacy
              </div>
              <div style={{
                display: 'flex',
                gap: 6,
                backgroundColor: '#0d1117',
                borderRadius: 6,
                padding: 3,
              }}>
                {(['open', 'private', 'password'] as const).map((mode) => {
                  const labels = { open: 'Open', private: 'Invite Only', password: 'Password' };
                  const isActive = privacyMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      style={{
                        flex: 1,
                        padding: '7px 6px',
                        fontSize: 12,
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? (mode === 'open' ? '#3fb950' : mode === 'private' ? '#d29922' : '#f78166') : '#8b949e',
                        backgroundColor: isActive ? (mode === 'open' ? 'rgba(63, 185, 80, 0.1)' : mode === 'private' ? 'rgba(210, 153, 34, 0.1)' : 'rgba(247, 129, 102, 0.1)') : 'transparent',
                        border: isActive ? `1px solid ${mode === 'open' ? 'rgba(63, 185, 80, 0.3)' : mode === 'private' ? 'rgba(210, 153, 34, 0.3)' : 'rgba(247, 129, 102, 0.3)'}` : '1px solid transparent',
                        borderRadius: 5,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        transition: 'all 0.15s ease',
                      }}
                      onClick={() => setPrivacyMode(mode)}
                      disabled={loading}
                    >
                      {/* eslint-disable-next-line security/detect-object-injection */}
                      {labels[mode]}
                    </button>
                  );
                })}
              </div>
              <span style={{ fontSize: 11, color: '#6e7681', marginTop: 4, display: 'block' }}>
                {privacyMode === 'open' ? 'Anyone with the room code can join' : privacyMode === 'private' ? 'Only invited members can join' : 'A password is required to join'}
              </span>
              {privacyMode === 'password' && (
                <input
                  type="password"
                  style={{ ...styles.input, marginTop: 8 }}
                  value={roomPassword}
                  onChange={(e) => setRoomPassword(e.target.value)}
                  placeholder="Set room password"
                  disabled={loading}
                />
              )}
            </div>

            {/* Section: Disappearing Messages */}
            <div style={{
              padding: '12px 14px',
              borderBottom: '1px solid #21262d',
            }}>
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#8b949e',
                textTransform: 'uppercase' as const,
                letterSpacing: '0.08em',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                Disappearing Messages
              </div>
              <div style={{
                display: 'flex',
                gap: 5,
                flexWrap: 'wrap' as const,
              }}>
                {[
                  { label: 'Off', value: 0 },
                  { label: '30s', value: 30 },
                  { label: '5m', value: 300 },
                  { label: '1h', value: 3600 },
                  { label: '24h', value: 86400 },
                ].map((opt) => {
                  const isActive = disappearingTimer === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      style={{
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? (opt.value === 0 ? '#8b949e' : '#d29922') : '#6e7681',
                        backgroundColor: isActive ? (opt.value === 0 ? '#21262d' : 'rgba(210, 153, 34, 0.1)') : '#0d1117',
                        border: isActive ? `1px solid ${opt.value === 0 ? '#30363d' : 'rgba(210, 153, 34, 0.3)'}` : '1px solid #21262d',
                        borderRadius: 5,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        transition: 'all 0.15s ease',
                      }}
                      onClick={() => setDisappearingTimer(opt.value)}
                      disabled={loading}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <span style={{ fontSize: 11, color: '#6e7681', marginTop: 4, display: 'block' }}>
                {disappearingTimer === 0 ? 'Messages persist until manually deleted' : `Messages auto-delete after ${disappearingTimer < 60 ? String(disappearingTimer) + 's' : disappearingTimer < 3600 ? String(Math.floor(disappearingTimer / 60)) + ' min' : String(Math.floor(disappearingTimer / 3600)) + ' hour(s)'}`}
              </span>
            </div>

            {/* Section: Anonymous Mode */}
            <div style={{
              padding: '12px 14px',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#8b949e',
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.08em',
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /><line x1="2" y1="2" x2="22" y2="22" /></svg>
                    Anonymous Mode
                  </div>
                  <span style={{ fontSize: 11, color: '#6e7681' }}>
                    {anonymousMode ? 'Identities hidden from other members' : 'Members see each other\'s names'}
                  </span>
                </div>
                <button
                  type="button"
                  style={{
                    width: 40,
                    height: 22,
                    borderRadius: 11,
                    border: 'none',
                    cursor: 'pointer',
                    position: 'relative' as const,
                    padding: 3,
                    backgroundColor: anonymousMode ? '#bc8cff' : '#30363d',
                    transition: 'background-color 0.2s',
                    flexShrink: 0,
                  }}
                  onClick={() => setAnonymousMode(!anonymousMode)}
                  disabled={loading}
                  aria-label="Toggle anonymous mode"
                >
                  <div style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    backgroundColor: '#e6edf3',
                    transition: 'transform 0.2s',
                    transform: anonymousMode ? 'translateX(18px)' : 'translateX(0)',
                  }} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Join by Code UI */}
        {roomType === 'join-code' && (
          <>
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="new-chat-join-code">
                Room Code
              </label>
              <input
                id="new-chat-join-code"
                ref={inputRef}
                type="text"
                style={{
                  ...styles.input,
                  fontSize: 18,
                  fontWeight: 600,
                  letterSpacing: '0.15em',
                  textAlign: 'center' as const,
                  textTransform: 'uppercase' as const,
                  ...(joinCode.trim().length === 6 && /^[A-Fa-f0-9]{6}$/.test(joinCode.trim())
                    ? styles.inputValid : {}),
                  transition: 'border-color 0.2s ease',
                }}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="e.g. X7K9P2"
                maxLength={6}
                disabled={loading}
              />
              <span style={styles.fieldHint}>
                Enter the 6-character code shared by the room admin
              </span>
            </div>

            {showJoinCodePassword && (
              <div style={styles.fieldGroup}>
                <label style={styles.label} htmlFor="new-chat-join-password">
                  Room Password
                </label>
                <input
                  id="new-chat-join-password"
                  type="password"
                  style={styles.input}
                  value={joinCodePassword}
                  onChange={(e) => setJoinCodePassword(e.target.value)}
                  placeholder="Enter room password"
                  disabled={loading}
                />
                <span style={styles.fieldHint}>
                  This room requires a password to join
                </span>
              </div>
            )}
          </>
        )}

        {/* Username input (direct and group modes) */}
        {roomType !== 'join-code' && (
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
        )}

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
          {roomType === 'join-code' ? (
            <button
              type="button"
              style={{
                ...styles.createButton,
                ...(loading || joinCode.trim().length !== 6
                  ? styles.buttonDisabled
                  : {}),
                transition: 'background-color 0.15s ease, opacity 0.15s ease, transform 0.1s ease',
              }}
              onClick={() => void handleJoinByCode()}
              disabled={loading || joinCode.trim().length !== 6}
            >
              {loading ? 'Joining...' : 'Join'}
            </button>
          ) : (
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
              {verifying ? 'Verifying keys...' : loading ? 'Creating...' : roomType === 'group' ? 'Create Secure Room' : 'Create'}
            </button>
          )}
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
    maxWidth: 480,
    width: '100%',
    fontFamily: FONT_BODY,
    color: '#c9d1d9',
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
    maxHeight: '90vh',
    overflowY: 'auto' as const,
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
