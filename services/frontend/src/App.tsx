/**
 * App — Root component for F.R.A.M.E. messaging application.
 *
 * Page flow: Landing → Auth (Sign In / Register) → App Shell (chat).
 *
 * Layout (app shell): sidebar (280px) + main content area.
 * Sidebar: user info, room list, "New Chat" button, settings gear.
 * Main area: active view (chat, settings, verify, link-device, or empty).
 * Modal overlays: DeviceAlert, KeyChangeAlert.
 *
 * On login:
 *   - Initialises vodozemac crypto (OlmMachine) and uploads keys
 *   - Registers the service worker for push notifications
 *   - Initialises encrypted IndexedDB storage
 *   - Fetches the user's room list
 *
 * Dark theme: #0d1117 bg, #161b22 cards, #30363d borders,
 *             #c9d1d9 text, #58a6ff accent.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { AuthResponse } from '@frame/shared';
import LandingPage from './pages/LandingPage';
import SignInPage from './pages/SignInPage';
import ChatWindow from './components/ChatWindow';
import DeviceList from './components/DeviceList';
import RoomList from './components/RoomList';
import NewChatDialog from './components/NewChatDialog';
import RoomSettings from './components/RoomSettings';
import FingerprintUI from './verification/fingerprintUI';
import DeviceLinking from './devices/deviceLinking';
import DeviceAlert from './devices/deviceAlert';
import type { UnknownDeviceInfo } from './devices/deviceAlert';
import KeyChangeAlert from './verification/keyChangeAlert';
import type { KeyChangeAction } from './verification/keyChangeAlert';
import { getAccessToken } from './api/client';
import { logout as apiLogout } from './api/authAPI';
import { formatDisplayName } from './utils/displayName';
import { listRooms, leaveRoom } from './api/roomsAPI';
import { getKnownDevices, verifyDevice } from './devices/deviceManager';
import type { RoomSummary } from './api/roomsAPI';
import { generateAndUploadKeys } from './crypto/keyManager';
import { getIdentityKeys } from './crypto/olmMachine';
import { invalidateRoomSession } from './crypto/sessionManager';
import { registerServiceWorker } from './notifications';
import { initStorage } from './storage/secureStorage';
import { useNotifications } from './hooks/useNotifications';
import SessionSettings from './components/SessionSettings';
import { useSessionTimeout, getAutoLock } from './hooks/useSessionTimeout';

// ── Types ──

type CurrentPage = 'landing' | 'auth' | 'app';
type ActiveView = 'chat' | 'settings' | 'verify' | 'link-device' | 'empty';

// ── Component ──

function App() {
  // Page-level navigation
  const [currentPage, setCurrentPage] = useState<CurrentPage>(() => {
    // If already authenticated (e.g. token in memory from a soft reload),
    // skip straight to the app shell.
    return getAccessToken() ? 'app' : 'landing';
  });

  const [auth, setAuth] = useState<AuthResponse | null>(null);

  // Layout and view state
  const [activeView, setActiveView] = useState<ActiveView>('empty');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [showNewChatDialog, setShowNewChatDialog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [initPhase, setInitPhase] = useState<'keys' | 'storage' | 'rooms' | 'done'>('keys');
  const [roomFetchError, setRoomFetchError] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const [showRoomSettings, setShowRoomSettings] = useState(false);

  // Lock screen state (auto-lock on inactivity)
  const [isLocked, setIsLocked] = useState(false);
  const [lockPassphrase, setLockPassphrase] = useState('');
  const [lockError, setLockError] = useState<string | null>(null);

  // Notification state
  const {
    requestPermission: requestNotifPermission,
    unreadCount,
    unreadByRoom,
    clearUnread,
    setInitialUnread,
  } = useNotifications();

  // Modal overlay state
  const [deviceAlertInfo, setDeviceAlertInfo] =
    useState<UnknownDeviceInfo | null>(null);
  const [keyChangeInfo, setKeyChangeInfo] = useState<{
    userId: string;
    oldPublicKey: string;
    newPublicKey: string;
  } | null>(null);

  // ── Session timeout ──

  const handleSessionTimeout = useCallback(() => {
    if (getAutoLock()) {
      setIsLocked(true);
    } else {
      // Full logout on timeout: revoke server-side tokens too.
      // apiLogout() calls clearTokens() internally and swallows errors.
      void apiLogout();
      setAuth(null);
      setCurrentPage('landing');
      setActiveView('empty');
      setSelectedRoomId(null);
      setRooms([]);
      setInitError(null);
      setInitPhase('keys');
      setRoomFetchError(null);
    }
  }, []);

  const { timeRemaining, isWarning, resetTimer } = useSessionTimeout(handleSessionTimeout);

  const handleUnlock = useCallback(() => {
    if (!auth) return;
    if (lockPassphrase === auth.userId) {
      setIsLocked(false);
      setLockPassphrase('');
      setLockError(null);
      resetTimer();
    } else {
      setLockError('Invalid credentials — enter your full user ID');
    }
  }, [auth, lockPassphrase, resetTimer]);

  // Online/offline detection (Fix 5)
  useEffect(() => {
    const handleOffline = () => setConnectionLost(true);
    const handleOnline = () => setConnectionLost(false);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    // Set initial state
    if (!navigator.onLine) setConnectionLost(true);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  // Inject spinner keyframes (Fix 3)
  useEffect(() => {
    const styleId = 'frame-spin-keyframes';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `@keyframes frame-spin { to { transform: rotate(360deg); } }`;
      document.head.appendChild(style);
    }
  }, []);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth < 768,
  );

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── Auth handler ──

  const handleAuthenticated = useCallback((authResponse: AuthResponse) => {
    setAuth(authResponse);
    setCurrentPage('app');
  }, []);

  // ── Post-login initialization ──

  useEffect(() => {
    if (!auth) return;
    const currentAuth = auth; // Capture for closure narrowing

    let cancelled = false;

    async function initialize() {
      try {
        // 1. Generate and upload device keys (handles initCrypto internally)
        if (!cancelled) setInitPhase('keys');
        await generateAndUploadKeys(currentAuth.userId, currentAuth.deviceId);

        // 2. Register service worker for push notifications
        await registerServiceWorker();

        // 3. Init encrypted IndexedDB storage with a user-derived passphrase.
        //    We hash `userId + ":frame-storage"` with SHA-256 to produce a
        //    deterministic, per-user passphrase (never store the raw password).
        if (!cancelled) setInitPhase('storage');
        const passphraseData = new TextEncoder().encode(
          currentAuth.userId + ':frame-storage',
        );
        const hashBuffer = await crypto.subtle.digest('SHA-256', passphraseData);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const storagePassphrase = hashArray
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        await initStorage(storagePassphrase);

        // 4. Fetch room list
        if (!cancelled) {
          setInitPhase('rooms');
          try {
            const roomList = await listRooms();
            setRooms(roomList);
            setRoomFetchError(null);

            // Seed unread counts from server data
            const initialUnread: Record<string, number> = {};
            for (const r of roomList) {
              if (r.unreadCount > 0) initialUnread[r.roomId] = r.unreadCount;
            }
            setInitialUnread(initialUnread);

            // Request notification permission after successful init
            void requestNotifPermission();
          } catch {
            console.warn('Failed to fetch rooms — API may not be ready.');
            setRoomFetchError('Failed to load conversations. Check your connection.');
          }
        }

        if (!cancelled) setInitPhase('done');
      } catch (err) {
        console.error('Initialization error:', err);
        if (!cancelled) {
          setInitError(
            err instanceof Error ? err.message : 'Initialization failed',
          );
        }
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [auth, setInitialUnread, requestNotifPermission]);

  // ── Handlers ──

  const handleLogout = useCallback(() => {
    // Revoke server-side refresh tokens, then clear local state.
    // apiLogout() already calls clearTokens() internally and swallows
    // network errors so the local logout always succeeds.
    void apiLogout();
    setAuth(null);
    setCurrentPage('landing');
    setActiveView('empty');
    setSelectedRoomId(null);
    setRooms([]);
    setInitError(null);
    setInitPhase('keys');
    setRoomFetchError(null);
    setIsLocked(false);
  }, []);

  const handleSelectRoom = useCallback(
    (roomId: string) => {
      setSelectedRoomId(roomId);
      setActiveView('chat');
      clearUnread(roomId);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, clearUnread],
  );

  const handleNewChatCreated = useCallback(
    (room: RoomSummary) => {
      setRooms((prev) => [room, ...prev]);
      setSelectedRoomId(room.roomId);
      setActiveView('chat');
      setShowNewChatDialog(false);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile],
  );

  const handleDeviceAlertVerify = useCallback(() => {
    setDeviceAlertInfo(null);
    setActiveView('link-device');
  }, []);

  const handleDeviceAlertRemove = useCallback(() => {
    setDeviceAlertInfo(null);
  }, []);

  const handleDeviceAlertIgnore = useCallback(() => {
    setDeviceAlertInfo(null);
  }, []);

  const handleKeyChangeAction = useCallback(
    (action: KeyChangeAction) => {
      if (action === 'view-fingerprint') {
        setKeyChangeInfo(null);
        setActiveView('verify');
      } else {
        setKeyChangeInfo(null);
      }
    },
    [],
  );

  const handleBackToSidebar = useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const handleOpenRoomSettings = useCallback(() => {
    setShowRoomSettings(true);
  }, []);

  const handleRoomRenamed = useCallback((roomId: string, newName: string) => {
    setRooms((prev) =>
      prev.map((r) => (r.roomId === roomId ? { ...r, name: newName } : r)),
    );
  }, []);

  const handleLeaveRoomFromSettings = useCallback((roomId: string) => {
    // Invalidate Megolm session for forward secrecy on leave
    void invalidateRoomSession(roomId).catch((err) =>
      console.warn('[F.R.A.M.E.] Failed to invalidate room session on leave:', err),
    );
    setRooms((prev) => prev.filter((r) => r.roomId !== roomId));
    setShowRoomSettings(false);
    if (selectedRoomId === roomId) {
      setSelectedRoomId(null);
      setActiveView('empty');
    }
  }, [selectedRoomId]);

  const handleRetryRoomFetch = useCallback(async () => {
    setRoomFetchError(null);
    try {
      const roomList = await listRooms();
      setRooms(roomList);
      const initialUnread: Record<string, number> = {};
      for (const r of roomList) {
        if (r.unreadCount > 0) initialUnread[r.roomId] = r.unreadCount;
      }
      setInitialUnread(initialUnread);
    } catch {
      setRoomFetchError('Failed to load conversations. Check your connection.');
    }
  }, [setInitialUnread]);

  const handleLeaveRoom = useCallback(async () => {
    if (!selectedRoomId) return;
    try {
      await leaveRoom(selectedRoomId);
      // Invalidate the Megolm session so the departed user (us) cannot
      // decrypt future messages — and remaining members will rotate keys.
      await invalidateRoomSession(selectedRoomId).catch((err) =>
        console.warn('[F.R.A.M.E.] Failed to invalidate room session on leave:', err),
      );
      setRooms((prev) => prev.filter((r) => r.roomId !== selectedRoomId));
      setSelectedRoomId(null);
      setActiveView('empty');
      setShowLeaveConfirm(false);
    } catch (err) {
      console.error('Failed to leave room:', err);
    }
  }, [selectedRoomId]);

  // ── Page: Landing ──
  if (currentPage === 'landing') {
    return <LandingPage onGetStarted={() => setCurrentPage('auth')} />;
  }

  // ── Page: Auth ──
  if (currentPage === 'auth') {
    return (
      <SignInPage
        onAuthenticated={handleAuthenticated}
        onBack={() => setCurrentPage('landing')}
      />
    );
  }

  // ── Page: App (not authenticated yet — shouldn't normally happen) ──
  if (!auth) {
    return <SignInPage onAuthenticated={handleAuthenticated} onBack={() => setCurrentPage('landing')} />;
  }

  // ── Lock screen (auto-lock on inactivity) ──
  if (isLocked) {
    return (
      <div style={styles.lockOverlay}>
        <div style={styles.lockCard}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ marginBottom: 16 }}>
            <rect x="10" y="22" width="28" height="20" rx="4" stroke="#58a6ff" strokeWidth="2" fill="rgba(88,166,255,0.06)" />
            <path d="M16 22v-6a8 8 0 0116 0v6" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" />
            <circle cx="24" cy="33" r="2" fill="#58a6ff" />
          </svg>
          <h2 style={styles.lockTitle}>Session Locked</h2>
          <p style={styles.lockSubtitle}>Enter your user ID to unlock</p>
          {lockError && <div style={styles.lockErrorBanner}>{lockError}</div>}
          <input
            type="password"
            style={styles.lockInput}
            value={lockPassphrase}
            onChange={(e) => setLockPassphrase(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleUnlock(); }}
            placeholder="User ID (e.g. @alice:example.com)"
            autoFocus
          />
          <div style={styles.lockActions}>
            <button type="button" style={styles.lockUnlockButton} onClick={handleUnlock}>Unlock</button>
            <button type="button" style={styles.lockLogoutButton} onClick={handleLogout}>Log out</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Initialization overlay ──
  if (initPhase !== 'done' && !initError) {
    const phaseLabels = new Map<string, string>([
      ['keys', 'Generating encryption keys...'],
      ['storage', 'Initializing secure storage...'],
      ['rooms', 'Loading conversations...'],
    ]);
    return (
      <div style={styles.initOverlay}>
        <div style={styles.initSpinner} />
        <p style={styles.initPhaseText}>{phaseLabels.get(initPhase) ?? 'Initializing...'}</p>
      </div>
    );
  }

  // ── Derive data for current view ──

  const selectedRoom = rooms.find((r) => r.roomId === selectedRoomId) || null;
  const memberUserIds = selectedRoom
    ? selectedRoom.members.map((m) => m.userId)
    : [];

  // Get identity keys for verification views (safe after init)
  let ownPublicKey = '';
  try {
    ownPublicKey = getIdentityKeys().curve25519;
  } catch {
    // Keys not yet initialized
  }

  // ── Render active view ──

  const renderMainContent = () => {
    switch (activeView) {
      case 'chat':
        if (!selectedRoomId) {
          return renderEmptyState();
        }
        {
          // Derive display name for the room header
          let chatDisplayName = selectedRoom?.name;
          if (!chatDisplayName && selectedRoom?.roomType === 'direct') {
            const other = selectedRoom.members.find((m) => m.userId !== auth.userId);
            chatDisplayName = other?.displayName || (other ? formatDisplayName(other.userId) : undefined);
          }
          if (!chatDisplayName && selectedRoom) {
            const names = selectedRoom.members
              .filter((m) => m.userId !== auth.userId)
              .slice(0, 3)
              .map((m) => m.displayName || formatDisplayName(m.userId));
            chatDisplayName = names.length > 0 ? names.join(', ') : 'Empty Room';
          }
          return (
            <ChatWindow
              key={selectedRoomId}
              roomId={selectedRoomId}
              currentUserId={auth.userId}
              memberUserIds={memberUserIds}
              roomDisplayName={chatDisplayName}
              roomType={selectedRoom?.roomType}
              memberCount={selectedRoom?.members.length}
              onOpenSettings={handleOpenRoomSettings}
              onRoomRenamed={handleRoomRenamed}
              onLeave={() => setShowLeaveConfirm(true)}
            />
          );
        }

      case 'settings':
        return (
          <div style={styles.settingsContainer}>
            <SessionSettings />
            <div style={{ borderTop: '1px solid #30363d', width: '100%', maxWidth: 440, margin: '8px 0 20px' }} />
            <DeviceList
              userId={auth.userId}
              currentDeviceId={auth.deviceId}
              onUnknownDevice={(device) =>
                setDeviceAlertInfo({
                  deviceId: device.deviceId,
                  deviceDisplayName: device.deviceDisplayName,
                  fingerprint: device.devicePublicKey || '',
                })
              }
            />
            <button
              type="button"
              style={{
                padding: '10px 20px',
                fontSize: 14,
                fontWeight: 600,
                backgroundColor: '#238636',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                alignSelf: 'center',
                marginTop: 8,
                maxWidth: 560,
                width: '100%',
              }}
              onClick={() => setActiveView('link-device')}
            >
              Link a New Device
            </button>
          </div>
        );

      case 'verify':
        return (
          <div style={styles.centeredContainer}>
            <FingerprintUI
              userId={keyChangeInfo?.userId || ''}
              deviceId=""
              publicKey={keyChangeInfo?.newPublicKey || ownPublicKey}
              ownPublicKey={ownPublicKey}
              onVerified={() => setActiveView('chat')}
            />
          </div>
        );

      case 'link-device':
        return (
          <div style={styles.centeredContainer}>
            <DeviceLinking
              devicePublicKey={ownPublicKey}
              onApprove={(fingerprint) => {
                // Find and verify the device matching this fingerprint
                void (async () => {
                  try {
                    const knownDevices = await getKnownDevices(auth.userId);
                    const matched = knownDevices.find(
                      (d) => d.fingerprint === fingerprint,
                    );
                    if (matched) {
                      await verifyDevice(auth.userId, matched.deviceId);
                    }
                  } catch (err) {
                    console.error('Failed to verify linked device:', err);
                  }
                  setActiveView('settings');
                })();
              }}
              onReject={() => {
                setActiveView('settings');
              }}
            />
          </div>
        );

      case 'empty':
      default:
        return renderEmptyState();
    }
  };

  const renderEmptyState = () => (
    <div style={styles.emptyMain}>
      <div style={styles.emptyIcon}>
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
          <rect x="6" y="10" width="44" height="32" rx="6" stroke="#30363d" strokeWidth="2" fill="rgba(88,166,255,0.04)" />
          <path d="M6 16l22 14 22-14" stroke="#30363d" strokeWidth="2" fill="none" />
        </svg>
      </div>
      <h2 style={styles.emptyTitle}>
        {rooms.length === 0 ? 'Welcome to F.R.A.M.E.' : 'Select a conversation'}
      </h2>
      <p style={styles.emptySubtitle}>
        {rooms.length === 0
          ? 'Your conversations are end-to-end encrypted. Start by creating your first chat.'
          : 'Choose a chat from the sidebar or start a new conversation'}
      </p>
      <button
        type="button"
        style={styles.emptyNewChatButton}
        onClick={() => setShowNewChatDialog(true)}
      >
        + New Chat
      </button>
      <p style={styles.emptyHelpText}>
        Send encrypted messages to anyone on your server
      </p>
    </div>
  );

  // ── Layout ──

  const showSidebar = isMobile ? sidebarOpen : true;
  const showMain = isMobile ? !sidebarOpen : true;

  return (
    <div style={styles.appWrapper}>
      {/* Session timeout warning */}
      {isWarning && timeRemaining < Infinity && (
        <div style={styles.sessionWarningBanner} onClick={() => resetTimer()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') resetTimer(); }}>
          Session expires in {Math.ceil(timeRemaining / 1000)} seconds — click to stay active
        </div>
      )}
      {/* Connection lost banner (Fix 5) */}
      {connectionLost && (
        <div style={styles.connectionBanner}>
          Connection lost — messages may be delayed
        </div>
      )}

      <div style={styles.appContainer}>
      {/* Sidebar */}
      {showSidebar && (
        <aside style={{
          ...styles.sidebar,
          ...(isMobile ? styles.sidebarMobile : {}),
        }}>
          {/* User info */}
          <div style={styles.userInfo}>
            <div style={styles.userAvatar}>
              {auth.userId.charAt(0) === '@'
                ? auth.userId.charAt(1).toUpperCase()
                : auth.userId.charAt(0).toUpperCase()}
            </div>
            <div style={styles.userDetails}>
              <span style={styles.userName}>{formatDisplayName(auth.userId)}</span>
              <span style={styles.userDevice}>
                Device: {auth.deviceId.slice(0, 8)}...
              </span>
            </div>
            {unreadCount > 0 && (
              <span style={styles.totalUnreadBadge}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>

          {/* Init error */}
          {initError && (
            <div style={styles.initError}>{initError}</div>
          )}

          {/* Room fetch error (Fix 2) */}
          {roomFetchError && (
            <div style={styles.roomFetchError}>
              <span>{roomFetchError}</span>
              <button
                type="button"
                style={styles.roomRetryButton}
                onClick={() => void handleRetryRoomFetch()}
              >
                Retry
              </button>
            </div>
          )}

          {/* Room list */}
          <div style={styles.roomListContainer}>
            <RoomList
              rooms={rooms}
              selectedRoomId={selectedRoomId}
              currentUserId={auth.userId}
              onSelectRoom={handleSelectRoom}
              unreadByRoom={unreadByRoom}
            />
          </div>

          {/* Bottom actions */}
          <div style={styles.sidebarActions}>
            <button
              type="button"
              style={styles.newChatButton}
              onClick={() => setShowNewChatDialog(true)}
            >
              + New Chat
            </button>
            <button
              type="button"
              style={styles.settingsButton}
              onClick={() => {
                setActiveView('settings');
                if (isMobile) setSidebarOpen(false);
              }}
              aria-label="Settings"
              title="Settings"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="2.5" stroke="#8b949e" strokeWidth="1.5" fill="none" />
                <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.34 3.34l1.42 1.42M13.24 13.24l1.42 1.42M3.34 14.66l1.42-1.42M13.24 4.76l1.42-1.42" stroke="#8b949e" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              style={styles.logoutButton}
              onClick={handleLogout}
              title="Log out"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M6 15H4a1 1 0 01-1-1V4a1 1 0 011-1h2M12 12l3-3-3-3M7 9h8" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </aside>
      )}

      {/* Main content */}
      {showMain && (
        <main style={styles.mainContent}>
          {/* Mobile back button */}
          {isMobile && (
            <button
              type="button"
              style={styles.backButton}
              onClick={handleBackToSidebar}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginRight: 6 }}>
                <path d="M10 3L5 8l5 5" stroke="#58a6ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>
          )}
          {renderMainContent()}
        </main>
      )}

      {/* Modal overlays */}
      {deviceAlertInfo && (
        <DeviceAlert
          device={deviceAlertInfo}
          onVerify={handleDeviceAlertVerify}
          onRemove={handleDeviceAlertRemove}
          onIgnore={handleDeviceAlertIgnore}
        />
      )}

      {keyChangeInfo && (
        <KeyChangeAlert
          userId={keyChangeInfo.userId}
          oldPublicKey={keyChangeInfo.oldPublicKey}
          newPublicKey={keyChangeInfo.newPublicKey}
          onAction={handleKeyChangeAction}
        />
      )}

      {/* New chat dialog */}
      {showNewChatDialog && (
        <NewChatDialog
          currentUserId={auth.userId}
          onCreated={handleNewChatCreated}
          onClose={() => setShowNewChatDialog(false)}
        />
      )}

      {/* Leave conversation confirm */}
      {showLeaveConfirm && (
        <div style={styles.leaveOverlay} onClick={() => setShowLeaveConfirm(false)}>
          <div style={styles.leaveModal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, color: '#f0f6fc' }}>Leave Conversation?</h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#8b949e', lineHeight: 1.5 }}>
              You will no longer receive messages from this conversation. This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" style={styles.leaveCancelBtn} onClick={() => setShowLeaveConfirm(false)}>Cancel</button>
              <button type="button" style={styles.leaveConfirmBtn} onClick={() => void handleLeaveRoom()}>Leave</button>
            </div>
          </div>
        </div>
      )}

      {/* Room settings panel */}
      {showRoomSettings && selectedRoom && (
        <RoomSettings
          room={selectedRoom}
          currentUserId={auth.userId}
          onClose={() => setShowRoomSettings(false)}
          onLeaveRoom={handleLeaveRoomFromSettings}
          onRoomRenamed={handleRoomRenamed}
          onMemberInvited={() => void handleRetryRoomFetch()}
        />
      )}
      </div>
    </div>
  );
}

// ── Styles (dark theme) ──

const styles: Record<string, React.CSSProperties> = {
  appWrapper: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  appContainer: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },

  // ── Sidebar ──
  sidebar: {
    width: 280,
    minWidth: 280,
    maxWidth: 280,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#161b22',
    borderRight: '1px solid #30363d',
    height: '100vh',
    overflow: 'hidden',
  },
  sidebarMobile: {
    width: '100vw',
    minWidth: '100vw',
    maxWidth: '100vw',
    borderRight: 'none',
  },

  // ── User info ──
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '16px 16px 12px',
    borderBottom: '1px solid #30363d',
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    backgroundColor: '#30363d',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 700,
    color: '#58a6ff',
    flexShrink: 0,
  },
  userDetails: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  userName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#e6edf3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  userDevice: {
    fontSize: 11,
    color: '#484f58',
  },
  totalUnreadBadge: {
    backgroundColor: '#58a6ff',
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 10,
    padding: '2px 8px',
    minWidth: 20,
    textAlign: 'center',
    flexShrink: 0,
    marginLeft: 'auto',
  },

  // ── Connection banner (Fix 5) ──
  connectionBanner: {
    padding: '4px 12px',
    backgroundColor: 'rgba(210, 153, 34, 0.15)',
    color: '#d29922',
    fontSize: 12,
    fontWeight: 500,
    textAlign: 'center',
    flexShrink: 0,
    width: '100%',
  },

  // ── Init overlay (Fix 3) ──
  initOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d1117',
    zIndex: 9999,
  },
  initSpinner: {
    width: 32,
    height: 32,
    border: '3px solid #30363d',
    borderTopColor: '#58a6ff',
    borderRadius: '50%',
    animation: 'frame-spin 0.8s linear infinite',
    marginBottom: 16,
  },
  initPhaseText: {
    fontSize: 14,
    color: '#8b949e',
    margin: 0,
  },

  // ── Init error ──
  initError: {
    padding: '6px 12px',
    margin: '8px 12px 0',
    backgroundColor: '#3d1f28',
    border: '1px solid #6e3630',
    borderRadius: 6,
    fontSize: 12,
    color: '#f85149',
  },

  // ── Room fetch error (Fix 2) ──
  roomFetchError: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 12px',
    margin: '8px 12px 0',
    backgroundColor: '#3d1f28',
    border: '1px solid #6e3630',
    borderRadius: 6,
    fontSize: 12,
    color: '#f85149',
  },
  roomRetryButton: {
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    backgroundColor: '#6e3630',
    color: '#f85149',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },

  // ── Room list ──
  roomListContainer: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },

  // ── Sidebar actions ──
  sidebarActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 16px',
    borderTop: '1px solid #30363d',
  },
  newChatButton: {
    flex: 1,
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background-color 0.15s',
  },
  settingsButton: {
    padding: '8px 10px',
    fontSize: 18,
    backgroundColor: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'border-color 0.15s',
  },
  logoutButton: {
    padding: '8px 10px',
    fontSize: 18,
    backgroundColor: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'border-color 0.15s',
  },

  // ── Main content ──
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: '#0d1117',
  },
  backButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 16px',
    fontSize: 14,
    backgroundColor: '#161b22',
    color: '#58a6ff',
    border: 'none',
    borderBottom: '1px solid #30363d',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
  },

  // ── Empty state ──
  emptyMain: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyIcon: {
    marginBottom: 16,
    opacity: 0.4,
  },
  emptyTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
    color: '#e6edf3',
  },
  emptySubtitle: {
    margin: '8px 0 0',
    fontSize: 14,
    color: '#8b949e',
    textAlign: 'center',
    maxWidth: 320,
  },
  emptyNewChatButton: {
    marginTop: 20,
    padding: '10px 24px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background-color 0.15s',
  },
  emptyHelpText: {
    marginTop: 10,
    fontSize: 12,
    color: '#484f58',
  },

  // ── Settings / centered views ──
  settingsContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 32,
    overflowY: 'auto',
  },
  centeredContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    overflowY: 'auto',
  },
  leaveOverlay: {
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
  },
  leaveModal: {
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 12,
    padding: 24,
    maxWidth: 380,
    width: '100%',
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
  },
  leaveCancelBtn: {
    padding: '8px 18px',
    fontSize: 13,
    fontWeight: 500,
    backgroundColor: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  leaveConfirmBtn: {
    padding: '8px 18px',
    fontSize: 13,
    fontWeight: 600,
    backgroundColor: '#da3633',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  // ── Session warning banner ──
  sessionWarningBanner: {
    padding: '6px 12px',
    backgroundColor: 'rgba(210, 153, 34, 0.2)',
    color: '#d29922',
    fontSize: 13,
    fontWeight: 600,
    textAlign: 'center' as const,
    cursor: 'pointer',
    flexShrink: 0,
    width: '100%',
    userSelect: 'none' as const,
  },

  // ── Lock screen ──
  lockOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d1117',
    zIndex: 10000,
  },
  lockCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: 40,
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 12,
    maxWidth: 380,
    width: '90%',
  },
  lockTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
    color: '#e6edf3',
  },
  lockSubtitle: {
    margin: '8px 0 16px',
    fontSize: 14,
    color: '#8b949e',
    textAlign: 'center' as const,
  },
  lockErrorBanner: {
    padding: '6px 12px',
    marginBottom: 12,
    backgroundColor: '#3d1f28',
    border: '1px solid #6e3630',
    borderRadius: 6,
    fontSize: 12,
    color: '#f85149',
    width: '100%',
    textAlign: 'center' as const,
  },
  lockInput: {
    width: '100%',
    padding: '10px 14px',
    fontSize: 14,
    borderRadius: 8,
    border: '1px solid #30363d',
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
    fontFamily: 'inherit',
    marginBottom: 16,
    boxSizing: 'border-box' as const,
  },
  lockActions: {
    display: 'flex',
    gap: 10,
    width: '100%',
  },
  lockUnlockButton: {
    flex: 1,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  lockLogoutButton: {
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: 'transparent',
    color: '#f85149',
    border: '1px solid #6e3630',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};

export default App;
