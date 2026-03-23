/**
 * NewChatDialog — TeamViewer-style session setup for F.R.A.M.E.
 *
 * Three tabs:
 * 1. "Start Session" — Creates a session, shows a generated Session ID
 *    prominently (formatted like "X7K-9P2"), optional password. Creator
 *    waits in a "waiting for others" state.
 * 2. "Join Session" — Enter a session ID (auto-dash formatted input) and
 *    optional password to connect to an existing session.
 * 3. "Direct Message" — Legacy username-based DM for power users.
 *
 * All user input is sanitized before display. Uses DOMPurify.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
import { createRoom, joinByCode, getRoomCode } from '../api/roomsAPI';
import type { RoomSummary } from '../api/roomsAPI';
import { FrameApiError } from '../api/client';
import { fetchAndVerifyKey } from '../verification/keyTransparency';
import { FONT_BODY, FONT_MONO } from '../globalStyles';
import { useIsMobile } from '../hooks/useIsMobile';
import { generateSessionName } from '../utils/codenames';
import { playJoinSound, playErrorSound } from '../sounds';
import { incrementRoomsCreated, checkAchievements } from '../utils/rankSystem';

// ── Friendly error mapping ──

/** Map raw API error codes to user-friendly messages */
function friendlyErrorMessage(err: unknown, isGuest: boolean): string {
  if (err instanceof FrameApiError) {
    switch (err.code) {
      case 'M_BAD_JSON':
        return isGuest
          ? 'Guest sessions have limited features. Create an account for the full experience.'
          : 'Could not create the session. Please try again.';
      case 'M_FORBIDDEN':
        if (isGuest) {
          return 'Guest sessions have limited features. Create an account for the full experience.';
        }
        // Preserve password-related messages so the UI can show the password field
        if (err.message.toLowerCase().includes('password')) {
          return err.message;
        }
        return "You don't have permission to do this.";
      case 'M_RATE_LIMITED':
        return 'Too many requests. Please wait a moment.';
      case 'M_NOT_FOUND':
        return 'Room not found. Check the code and try again.';
      case 'M_SESSION_EXPIRED':
        return 'Your session has expired. Please sign in again.';
      default:
        return isGuest
          ? 'Guest sessions have limited features. Create an account for the full experience.'
          : 'Something went wrong. Please try again.';
    }
  }
  if (err instanceof Error) {
    // For non-API errors (network failures, etc.), still show a friendly message
    if (isGuest) {
      return 'Guest sessions have limited features. Create an account for the full experience.';
    }
    // Check for common patterns but never show raw technical messages
    if (err.message.toLowerCase().includes('network') || err.message.toLowerCase().includes('fetch')) {
      return 'Connection issue. Please check your network and try again.';
    }
    if (err.message.toLowerCase().includes('password')) {
      return err.message; // Password hints are already user-facing
    }
    return 'Something went wrong. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

// ── Types ──

interface NewChatDialogProps {
  currentUserId: string;
  isGuest?: boolean;
  existingRooms?: RoomSummary[];
  onCreated: (room: RoomSummary) => void;
  onClose: () => void;
}

type TabMode = 'start' | 'join' | 'dm';

// ── Helpers ──

/**
 * Format a raw invite code as a tactical FREQ code for display.
 * Raw backend code is 6 hex chars (e.g. "A3F5BE"). Format as "A3F-5BE".
 */
function formatSessionId(code: string): string {
  const clean = code.replace(/[^A-F0-9]/gi, '').toUpperCase();
  if (clean.length <= 3) return clean;
  return clean.slice(0, 3) + '-' + clean.slice(3, 6);
}

/** Format with FREQ prefix for display */
function formatFreqDisplay(code: string): string {
  return formatSessionId(code);
}

/** Strip dashes from a formatted session ID */
function stripDashes(value: string): string {
  return value.replace(/-/g, '').replace(/^FREQ:\s*/i, '').toUpperCase();
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
    @keyframes frame-pulse-ring {
      0% { transform: scale(1); opacity: 0.4; }
      50% { transform: scale(1.15); opacity: 0.15; }
      100% { transform: scale(1); opacity: 0.4; }
    }
    @keyframes frame-waiting-dot {
      0%, 20% { opacity: 0.2; }
      50% { opacity: 1; }
      80%, 100% { opacity: 0.2; }
    }
    @keyframes frame-pill-slide {
      0% { transform: translateX(var(--pill-from, 0)); }
      100% { transform: translateX(var(--pill-to, 0)); }
    }
  `;
  document.head.appendChild(style);
}

// ── Component ──

const NewChatDialog: React.FC<NewChatDialogProps> = ({
  currentUserId,
  isGuest = false,
  existingRooms = [],
  onCreated,
  onClose,
}) => {
  const isMobile = useIsMobile();

  // Tab state
  const [activeTab, setActiveTab] = useState<TabMode>('start');

  // Start Session state
  const [sessionPassword, setSessionPassword] = useState('');
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sessionCreated, setSessionCreated] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [sessionRoomId, setSessionRoomId] = useState('');
  const [sessionCodename, setSessionCodename] = useState('');
  const [copied, setCopied] = useState(false);

  // Join Session state
  const [joinSessionId, setJoinSessionId] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [showJoinPassword, setShowJoinPassword] = useState(false);
  const [joining, setJoining] = useState(false);

  // Direct Message state
  const [username, setUsername] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [dmLoading, setDmLoading] = useState(false);

  // Shared state
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
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
      triggerRef.current?.focus();
    };
  }, []);

  // Focus trap
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
  }, [showSuccess, sessionCreated]);

  // Prevent background scrolling
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Handle Escape
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (activeTab === 'join') {
        void handleJoinSession();
      } else if (activeTab === 'dm') {
        void handleCreateDM();
      }
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // ── Start Session ──

  const handleStartSession = useCallback(async () => {
    setCreatingSession(true);
    setError(null);

    try {
      const codename = generateSessionName();
      const result = await createRoom(
        'group',
        [],
        codename,
        {
          isPrivate: true,
          password: showPasswordField && sessionPassword.trim()
            ? sessionPassword.trim()
            : undefined,
        },
      );

      // Fetch the invite code for this room
      const codeResult = await getRoomCode(result.roomId);
      const code = codeResult.inviteCode ?? '';

      incrementRoomsCreated();
      checkAchievements();
      setSessionCodename(codename);
      setSessionRoomId(result.roomId);
      setSessionId(code);
      setSessionCreated(true);
    } catch (err) {
      setError(friendlyErrorMessage(err, isGuest));
    } finally {
      setCreatingSession(false);
    }
  }, [sessionPassword, showPasswordField, isGuest]);

  const handleCopySessionId = useCallback(() => {
    // Copy the raw 6-char hex code without dash so it pastes cleanly into the join field
    const raw = stripDashes(sessionId);
    void navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [sessionId]);

  const handleEnterSession = useCallback(() => {
    playJoinSound();
    const newRoom: RoomSummary = {
      roomId: sessionRoomId,
      roomType: 'group',
      name: sessionCodename || 'Secure Session',
      members: [{ userId: currentUserId }],
      unreadCount: 0,
    };
    onCreated(newRoom);
    onClose(); // Close the dialog overlay so chat is interactive
  }, [sessionRoomId, sessionCodename, currentUserId, onCreated, onClose]);

  // ── Join Session ──

  const handleJoinSessionIdChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow hex characters (A-F, 0-9) — FREQ format: XXX-XXX (6 chars total)
    let raw = e.target.value.replace(/[^A-Fa-f0-9-]/g, '').toUpperCase();
    // Remove all dashes first to normalize
    const stripped = raw.replace(/-/g, '');
    // Only keep up to 6 chars
    const trimmed = stripped.slice(0, 6);
    // Re-format with dash after 3 chars (e.g. A3F-5BE)
    if (trimmed.length > 3) {
      raw = trimmed.slice(0, 3) + '-' + trimmed.slice(3);
    } else {
      raw = trimmed;
    }
    setJoinSessionId(raw);
    setError(null);
  }, []);

  const handleJoinSession = useCallback(async () => {
    const code = stripDashes(joinSessionId);
    if (!code) {
      setError('Please enter a FREQ code.');
      return;
    }
    if (code.length !== 6 || !/^[A-F0-9]{6}$/.test(code)) {
      setError('Invalid FREQ code. Use format A7B-4C2 (6 hex characters: 0-9, A-F).');
      return;
    }

    setJoining(true);
    setError(null);

    try {
      const result = await joinByCode(code, joinPassword.trim() || undefined);
      const newRoom: RoomSummary = {
        roomId: result.roomId,
        roomType: 'group',
        name: result.name ?? generateSessionName(),
        members: [{ userId: currentUserId }],
        unreadCount: 0,
      };

      playJoinSound();
      setShowSuccess(true);
      setTimeout(() => {
        onCreated(newRoom);
      }, 1000);
    } catch (err) {
      // If the error mentions a password or is a 403 Forbidden, reveal the password field
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const code = err instanceof FrameApiError ? err.code : '';
      if (msg.includes('password') || (code === 'M_FORBIDDEN' && !joinPassword)) {
        setShowJoinPassword(true);
        setError('This session requires a password to join.');
        playErrorSound();
      } else {
        setError(friendlyErrorMessage(err, isGuest));
        playErrorSound();
      }
    } finally {
      setJoining(false);
    }
  }, [joinSessionId, joinPassword, currentUserId, onCreated, isGuest]);

  // ── Direct Message ──

  const handleCreateDM = useCallback(async () => {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError('Please enter a username.');
      return;
    }

    // Auto-format plain username to full Matrix-style userId
    // e.g. "abc" → "@abc:project-frame-production.up.railway.app"
    const homeserverDomain = (process.env.REACT_APP_HOMESERVER_URL || '')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    const fullUserId = trimmedUsername.startsWith('@')
      ? trimmedUsername
      : `@${trimmedUsername}:${homeserverDomain}`;

    if (fullUserId === currentUserId) {
      setError('You cannot message yourself.');
      return;
    }

    // Check if a DM room with this user already exists
    const existingDM = existingRooms.find(
      (r) =>
        r.roomType === 'direct' &&
        r.members?.some((m) => m.userId === fullUserId),
    );
    if (existingDM) {
      onCreated(existingDM);
      onClose();
      return;
    }

    setDmLoading(true);
    setVerifying(true);
    setError(null);

    try {
      try {
        const verification = await fetchAndVerifyKey(fullUserId);
        if (!verification.verified && verification.proof !== null) {
          console.warn(
            `[F.R.A.M.E.] Key transparency verification failed for ${fullUserId} — proceeding.`,
          );
        }
      } catch (err) {
        console.warn(
          `[F.R.A.M.E.] Could not verify key for ${fullUserId}:`,
          err instanceof Error ? err.message : err,
        );
      }
      setVerifying(false);

      const result = await createRoom('direct', [fullUserId]);
      incrementRoomsCreated();
      checkAchievements();
      const newRoom: RoomSummary = {
        roomId: result.roomId,
        roomType: 'direct',
        name: undefined,
        members: [
          { userId: currentUserId },
          { userId: fullUserId },
        ],
        unreadCount: 0,
      };

      setShowSuccess(true);
      setTimeout(() => {
        onCreated(newRoom);
      }, 1000);
    } catch (err) {
      setError(friendlyErrorMessage(err, isGuest));
    } finally {
      setDmLoading(false);
    }
  }, [username, currentUserId, onCreated, isGuest]);

  // ── Success state ──

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
          <div style={{
            position: 'relative' as const,
            width: 80,
            height: 80,
          }}>
            <div style={{
              position: 'absolute' as const,
              top: 0, left: 0, width: 80, height: 80,
              borderRadius: '50%',
              border: '3px solid #3fb950',
              animation: 'frame-success-ring 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            }} />
            <svg width="80" height="80" viewBox="0 0 80 80" style={{
              position: 'absolute' as const,
              top: 0, left: 0,
              animation: 'frame-success-checkmark 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.2s both',
            }}>
              <path d="M24 40l10 10 22-22" stroke="#3fb950" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          <p style={{
            color: '#e6edf3',
            fontSize: 16,
            fontWeight: 600,
            margin: 0,
            animation: 'frame-dialog-slide-up 0.4s ease-out 0.3s both',
          }}>
            Connected!
          </p>
        </div>
      </div>
    );
  }

  // ── Waiting state (session created, waiting for others) ──

  if (sessionCreated) {
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
            } : {}),
            textAlign: 'center' as const,
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-waiting-title"
          onKeyDown={handleKeyDown}
        >
          {/* Close button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button
              type="button"
              style={styles.closeButton}
              onClick={onClose}
              aria-label="Close"
            >
              &#10005;
            </button>
          </div>

          {/* Shield icon with pulse */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: 20,
          }}>
            <div style={{ position: 'relative' as const, width: 64, height: 64 }}>
              <div style={{
                position: 'absolute' as const,
                top: -8, left: -8,
                width: 80, height: 80,
                borderRadius: '50%',
                border: '2px solid rgba(88, 166, 255, 0.2)',
                animation: 'frame-pulse-ring 2s ease-in-out infinite',
              }} />
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="1.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" stroke="#3fb950" strokeWidth="2" />
              </svg>
            </div>
          </div>

          <h2 id="session-waiting-title" style={{
            margin: '0 0 6px',
            fontSize: 18,
            fontWeight: 600,
            color: '#f0f6fc',
          }}>
            {'\uD83D\uDCE1'} COMMS CHANNEL ESTABLISHED
          </h2>

          <p style={{
            fontSize: 13,
            color: '#8b949e',
            margin: '0 0 24px',
          }}>
            Share this FREQ code with the person you want to connect with
          </p>

          {/* Session ID display — tactical mission style */}
          <div style={{
            backgroundColor: '#0d1117',
            border: '1.5px solid rgba(63, 185, 80, 0.4)',
            borderRadius: 6,
            padding: '28px 24px',
            marginBottom: 16,
            boxShadow: '0 0 12px rgba(63, 185, 80, 0.08), inset 0 0 20px rgba(63, 185, 80, 0.03)',
          }}>
            {/* Mission codename + code */}
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#3fb950',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.12em',
              marginBottom: 16,
              fontFamily: FONT_MONO,
              textAlign: 'center' as const,
              textShadow: '0 0 8px rgba(63, 185, 80, 0.3)',
            }}>
              {sessionCodename} [{stripDashes(sessionId)}]
            </div>
            <div style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#3fb950',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.15em',
              marginBottom: 14,
              fontFamily: FONT_MONO,
            }}>
              {'\u25C8'} FREQ CODE
            </div>
            <div style={{
              fontFamily: FONT_MONO,
              fontSize: 38,
              fontWeight: 700,
              color: '#3fb950',
              letterSpacing: '0.22em',
              userSelect: 'all' as const,
              marginBottom: 18,
              lineHeight: 1.2,
              textAlign: 'center' as const,
              textShadow: '0 0 12px rgba(63, 185, 80, 0.4)',
            }}>
              {formatFreqDisplay(sessionId)}
            </div>

            {/* Copy button */}
            <button
              type="button"
              style={{
                padding: '10px 24px',
                fontSize: 14,
                fontWeight: 600,
                backgroundColor: copied ? 'rgba(63, 185, 80, 0.2)' : 'rgba(63, 185, 80, 0.08)',
                color: copied ? '#3fb950' : '#3fb950',
                border: `1px solid ${copied ? 'rgba(63, 185, 80, 0.5)' : 'rgba(63, 185, 80, 0.3)'}`,
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: FONT_MONO,
                transition: 'all 0.2s ease',
                minWidth: 180,
              }}
              onClick={handleCopySessionId}
            >
              {copied ? 'Copied!' : 'Copy FREQ Code'}
            </button>

            {showPasswordField && sessionPassword.trim() && (
              <div style={{
                marginTop: 16,
                paddingTop: 16,
                borderTop: '1px solid #21262d',
              }}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#8b949e',
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.1em',
                  marginBottom: 6,
                }}>
                  Session Password
                </div>
                <div style={{
                  fontFamily: FONT_MONO,
                  fontSize: 16,
                  color: '#d29922',
                  letterSpacing: '0.05em',
                }}>
                  {sessionPassword}
                </div>
                <div style={{
                  fontSize: 11,
                  color: '#6e7681',
                  marginTop: 4,
                }}>
                  The other person will need this password to connect
                </div>
              </div>
            )}
          </div>

          {/* Waiting indicator — centered and calm */}
          <div style={{
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            marginBottom: isMobile ? 24 : 20,
            color: '#8b949e',
            fontSize: 13,
            padding: isMobile ? '8px 0' : 0,
          }}>
            <span>Waiting for others to join</span>
            <span style={{ display: 'inline-flex', gap: 3 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    backgroundColor: '#8b949e',
                    display: 'inline-block',
                    animation: `frame-waiting-dot 1.4s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </span>
          </div>

          {/* Actions */}
          <div style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'center',
            ...(isMobile ? { flexDirection: 'column-reverse' as const, gap: 8 } : {}),
          }}>
            <button
              type="button"
              style={{
                ...styles.cancelButton,
                transition: 'all 0.15s ease',
                ...(isMobile ? { width: '100%', minHeight: 48, justifyContent: 'center' } : {}),
              }}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              style={{
                ...styles.createButton,
                transition: 'all 0.15s ease',
                ...(isMobile ? { width: '100%', minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}),
              }}
              onClick={handleEnterSession}
            >
              Enter Session
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main dialog ──

  const isLoading = creatingSession || joining || dmLoading;

  const tabs: { key: TabMode; label: string; icon: React.ReactNode }[] = [
    {
      key: 'start',
      label: 'Start Session',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
    },
    {
      key: 'join',
      label: 'Join Session',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
          <polyline points="10 17 15 12 10 7" />
          <line x1="15" y1="12" x2="3" y2="12" />
        </svg>
      ),
    },
    {
      key: 'dm',
      label: 'Direct Message',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      ),
    },
  ];

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
            {activeTab === 'start'
              ? 'New Secure Session'
              : activeTab === 'join'
                ? 'Connect to Session'
                : 'Direct Message'}
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

        {/* Tab selector */}
        <div style={{
          display: 'flex',
          gap: 0,
          backgroundColor: 'rgba(13, 17, 23, 0.8)',
          borderRadius: 10,
          padding: 3,
          marginBottom: 20,
          width: '100%',
          border: '1px solid #21262d',
          flexWrap: 'nowrap' as const,
          overflow: 'hidden',
        }}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: isMobile ? '10px 6px' : '10px 12px',
                  fontSize: isMobile ? 12 : 12,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#f0f6fc' : '#8b949e',
                  backgroundColor: isActive ? '#21262d' : 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: isMobile ? 4 : 6,
                  minHeight: 40,
                  boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                }}
                onClick={() => { setActiveTab(tab.key); setError(null); }}
                disabled={isLoading}
              >
                {tab.icon}
                {isMobile ? tab.label.split(' ')[0] : tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Tab: Start Session ── */}
        {activeTab === 'start' && (
          <div style={{ animation: 'frame-dialog-slide-up 0.2s ease-out' }}>
            {/* Explanation */}
            <div style={{
              backgroundColor: 'rgba(13, 17, 23, 0.6)',
              border: '1px solid rgba(48, 54, 61, 0.6)',
              borderRadius: 10,
              padding: 16,
              marginBottom: 20,
            }}>
              <div style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="1.5" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 4 }}>
                    How it works
                  </div>
                  <ol style={{
                    margin: 0,
                    paddingLeft: 16,
                    fontSize: 12,
                    color: '#8b949e',
                    lineHeight: 1.6,
                  }}>
                    <li>Click &ldquo;Create Session&rdquo; to establish a comms channel</li>
                    <li>Share the FREQ code with your contact (via phone, text, etc.)</li>
                    <li>They enter the FREQ code in &ldquo;Join Session&rdquo; to connect</li>
                  </ol>
                </div>
              </div>
            </div>

            {/* Optional password toggle */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: showPasswordField ? 8 : 20,
              padding: '8px 0',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#c9d1d9' }}>
                  Require password
                </div>
                <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>
                  Add an extra layer of security
                </div>
              </div>
              <button
                type="button"
                style={{
                  width: 42,
                  height: 24,
                  borderRadius: 12,
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative' as const,
                  padding: 3,
                  backgroundColor: showPasswordField ? '#238636' : '#30363d',
                  transition: 'background-color 0.2s ease',
                  flexShrink: 0,
                }}
                onClick={() => setShowPasswordField(!showPasswordField)}
                disabled={isLoading}
                aria-label="Toggle password requirement"
              >
                <div style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  backgroundColor: '#e6edf3',
                  transition: 'transform 0.2s ease',
                  transform: showPasswordField ? 'translateX(18px)' : 'translateX(0)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </button>
            </div>

            {showPasswordField && (
              <div style={{ ...styles.fieldGroup, marginBottom: 20 }}>
                <input
                  type="password"
                  style={styles.input}
                  value={sessionPassword}
                  onChange={(e) => setSessionPassword(e.target.value)}
                  placeholder="Set a session password"
                  disabled={isLoading}
                />
                <span style={styles.fieldHint}>
                  Anyone connecting will need this password
                </span>
              </div>
            )}

            {/* Create button */}
            <button
              type="button"
              style={{
                width: '100%',
                padding: '14px 20px',
                fontSize: 15,
                fontWeight: 600,
                backgroundColor: '#238636',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                opacity: isLoading ? 0.6 : 1,
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                minHeight: 48,
              }}
              onClick={() => void handleStartSession()}
              disabled={isLoading}
            >
              {creatingSession ? (
                <>
                  <span style={{
                    width: 16, height: 16,
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'frame-pulse-ring 1s linear infinite',
                  }} />
                  {'\uD83D\uDCE1'} ESTABLISHING COMMS CHANNEL...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  Create Session
                </>
              )}
            </button>
          </div>
        )}

        {/* ── Tab: Join Session ── */}
        {activeTab === 'join' && (
          <div style={{ animation: 'frame-dialog-slide-up 0.2s ease-out' }}>
            <div style={styles.fieldGroup}>
              <label style={{ ...styles.label, fontFamily: FONT_MONO, color: '#3fb950', letterSpacing: '0.1em' }} htmlFor="join-session-id">
                FREQ CODE
              </label>
              <input
                id="join-session-id"
                ref={inputRef}
                type="text"
                style={{
                  ...styles.input,
                  fontFamily: FONT_MONO,
                  fontSize: 24,
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  textAlign: 'center' as const,
                  textTransform: 'uppercase' as const,
                  padding: '14px 16px',
                  borderColor: stripDashes(joinSessionId).length === 6 ? '#3fb950' : undefined,
                  boxShadow: stripDashes(joinSessionId).length === 6 ? '0 0 8px rgba(63, 185, 80, 0.2)' : undefined,
                  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                }}
                value={joinSessionId}
                onChange={handleJoinSessionIdChange}
                placeholder="Enter code (e.g. A3F-5BE)"
                maxLength={7} // 6 chars + 1 dash
                disabled={isLoading}
              />
              <span style={styles.fieldHint}>
                Enter the FREQ code shared with you (e.g., A7-B2)
              </span>
            </div>

            {showJoinPassword && (
              <div style={styles.fieldGroup}>
                <label style={styles.label} htmlFor="join-session-password">
                  Session Password
                </label>
                <input
                  id="join-session-password"
                  type="password"
                  style={styles.input}
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  placeholder="Enter the session password"
                  disabled={isLoading}
                />
                <span style={styles.fieldHint}>
                  This session requires a password to connect
                </span>
              </div>
            )}

            {/* Actions */}
            <div style={{
              ...styles.actions,
              marginTop: 16,
              ...(isMobile ? { flexDirection: 'column-reverse' as const, gap: 8 } : {}),
            }}>
              <button
                type="button"
                style={{
                  ...styles.cancelButton,
                  transition: 'all 0.15s ease',
                  ...(isMobile ? { width: '100%', minHeight: 48, justifyContent: 'center' } : {}),
                }}
                onClick={onClose}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{
                  ...styles.createButton,
                  ...(isLoading || stripDashes(joinSessionId).length !== 6 ? styles.buttonDisabled : {}),
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  ...(isMobile ? { width: '100%', minHeight: 48 } : {}),
                }}
                onClick={() => void handleJoinSession()}
                disabled={isLoading || stripDashes(joinSessionId).length !== 6}
              >
                {joining ? (
                  <>
                    <span style={{
                      width: 14, height: 14,
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTopColor: '#fff',
                      borderRadius: '50%',
                      display: 'inline-block',
                      animation: 'frame-pulse-ring 1s linear infinite',
                    }} />
                    Connecting...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="10 17 15 12 10 7" />
                    </svg>
                    Connect
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Tab: Direct Message ── */}
        {activeTab === 'dm' && (
          <div style={{ animation: 'frame-dialog-slide-up 0.2s ease-out' }}>
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="dm-username">
                Username
              </label>
              <div style={{ ...styles.inputWrapper }}>
                <input
                  id="dm-username"
                  ref={inputRef}
                  type="text"
                  style={{
                    ...styles.input,
                    ...(username.trim() && /^@[^:]+:.+$/.test(username.trim()) ? styles.inputValid : {}),
                    transition: 'border-color 0.2s ease',
                  }}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. @alice:frame.local"
                  disabled={isLoading}
                />
                {username.trim() && /^@[^:]+:.+$/.test(username.trim()) && (
                  <span style={styles.validIcon} title="Valid username format">
                    &#10003;
                  </span>
                )}
              </div>
              <span style={styles.fieldHint}>
                {username.trim().length === 0
                  ? 'Enter a full username in @user:server format'
                  : /^@[^:]+:.+$/.test(username.trim())
                    ? 'Valid username format'
                    : 'Expected format: @user:server'}
              </span>
            </div>

            {/* Actions */}
            <div style={{
              ...styles.actions,
              marginTop: 16,
              ...(isMobile ? { flexDirection: 'column-reverse' as const, gap: 8 } : {}),
            }}>
              <button
                type="button"
                style={{
                  ...styles.cancelButton,
                  transition: 'all 0.15s ease',
                  ...(isMobile ? { width: '100%', minHeight: 48, justifyContent: 'center' } : {}),
                }}
                onClick={onClose}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{
                  ...styles.createButton,
                  ...(isLoading || !username.trim() ? styles.buttonDisabled : {}),
                  transition: 'all 0.15s ease',
                  ...(isMobile ? { width: '100%', minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}),
                }}
                onClick={() => void handleCreateDM()}
                disabled={isLoading || !username.trim()}
              >
                {verifying ? 'Verifying keys...' : dmLoading ? 'Creating...' : 'Send Message'}
              </button>
            </div>
          </div>
        )}
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
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9998,
    padding: 16,
  },
  modal: {
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 14,
    padding: 28,
    maxWidth: 480,
    width: '100%',
    fontFamily: FONT_BODY,
    color: '#c9d1d9',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.03)',
    maxHeight: '90vh',
    overflowY: 'auto' as const,
    animation: 'frame-modal-enter 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
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
    fontSize: 16,
    cursor: 'pointer',
    padding: '4px 8px',
    lineHeight: 1,
    transition: 'color 0.15s ease',
    minWidth: 36,
    minHeight: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  error: {
    backgroundColor: 'rgba(248, 81, 73, 0.08)',
    border: '1px solid rgba(248, 81, 73, 0.25)',
    borderRadius: 8,
    padding: '10px 14px',
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
    padding: '10px 14px',
    fontSize: 16, /* 16px prevents iOS auto-zoom on focus */
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 8,
    color: '#c9d1d9',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
    width: '100%',
    minHeight: 48,
    transition: 'border-color 0.2s ease',
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
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 500,
    backgroundColor: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 44,
    transition: 'background-color 0.15s ease, border-color 0.15s ease',
  },
  createButton: {
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 44,
    transition: 'background-color 0.15s ease',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
};

export default NewChatDialog;
