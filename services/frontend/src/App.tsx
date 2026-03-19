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

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { AuthResponse } from '@frame/shared';
import SignInPage from './pages/SignInPage';
import ChatWindow from './components/ChatWindow';
import ToastContainer from './components/Toast';
import RoomList from './components/RoomList';
import NewChatDialog from './components/NewChatDialog';

// Lazy-load components not needed on initial render — reduces main bundle size
const LandingPage = React.lazy(() => import('./pages/LandingPage'));
const DeviceList = React.lazy(() => import('./components/DeviceList'));
const RoomSettings = React.lazy(() => import('./components/RoomSettings'));
const FingerprintUI = React.lazy(() => import('./verification/fingerprintUI'));
const DeviceLinking = React.lazy(() => import('./devices/deviceLinking'));
import DeviceAlert from './devices/deviceAlert';
import type { UnknownDeviceInfo } from './devices/deviceAlert';
import KeyChangeAlert from './verification/keyChangeAlert';
import type { KeyChangeAction } from './verification/keyChangeAlert';
import { getAccessToken } from './api/client';
import { logout as apiLogout } from './api/authAPI';
import { formatDisplayName } from './utils/displayName';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from './utils/purifyConfig';
import { listRooms, leaveRoom } from './api/roomsAPI';
import { getKnownDevices, verifyDevice } from './devices/deviceManager';
import type { RoomSummary } from './api/roomsAPI';
import { generateAndUploadKeys } from './crypto/keyManager';
import { getIdentityKeys } from './crypto/olmMachine';
import { invalidateRoomSession } from './crypto/sessionManager';
import { registerServiceWorker } from './notifications';
import { initStorage } from './storage/secureStorage';
import { useNotifications } from './hooks/useNotifications';
import { useToast } from './hooks/useToast';
import SessionSettings from './components/SessionSettings';
import ProfileSettings from './components/ProfileSettings';
import { useSessionTimeout, getAutoLock } from './hooks/useSessionTimeout';
import { useInstallPrompt } from './hooks/useInstallPrompt';

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
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [focusedRoomIndex, setFocusedRoomIndex] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  /* eslint-enable @typescript-eslint/no-unused-vars */

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

  // Toast notifications
  const { toasts, showToast, dismissToast } = useToast();

  // PWA install prompt
  const { showBanner: showInstallBanner, promptInstall, dismissBanner: dismissInstall } = useInstallPrompt();

  // Track previous connection state for reconnection toast
  const prevConnectionLostRef = useRef(false);

  // Settings: dismissible device verification banner
  const [settingsVerifyBannerDismissed, setSettingsVerifyBannerDismissed] = useState(false);

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

  // Online/offline detection (Fix 5) — now uses toast notifications
  useEffect(() => {
    const handleOffline = () => {
      setConnectionLost(true);
      prevConnectionLostRef.current = true;
      showToast('warning', 'Connection lost — messages may be delayed', {
        persistent: true,
        dedupeKey: 'connection-status',
      });
    };
    const handleOnline = () => {
      setConnectionLost(false);
      if (prevConnectionLostRef.current) {
        prevConnectionLostRef.current = false;
        showToast('success', 'Connection restored', {
          dedupeKey: 'connection-status',
        });
      }
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    // Set initial state
    if (!navigator.onLine) {
      setConnectionLost(true);
      prevConnectionLostRef.current = true;
      showToast('warning', 'Connection lost — messages may be delayed', {
        persistent: true,
        dedupeKey: 'connection-status',
      });
    }
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [showToast]);

  // Inject spinner keyframes (Fix 3)
  useEffect(() => {
    const styleId = 'frame-spin-keyframes';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes frame-spin { to { transform: rotate(360deg); } }
        @keyframes frame-tap-feedback {
          0% { transform: scale(1); }
          50% { transform: scale(0.95); }
          100% { transform: scale(1); }
        }
        @keyframes frame-fade-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @media (max-width: 767px) {
          button:active, [role="button"]:active {
            animation: frame-tap-feedback 0.15s ease-out !important;
          }
        }
        * { box-sizing: border-box; }
        html, body, #root { max-width: 100vw; overflow-x: hidden; }
      `;
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

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (currentPage !== 'app') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') { e.preventDefault(); searchInputRef.current?.focus(); return; }
      if (mod && e.key === 'n') { e.preventDefault(); setShowNewChatDialog(true); return; }
      if (mod && e.key === ',') { e.preventDefault(); setActiveView('settings'); if (isMobile) setSidebarOpen(false); return; }
      if (e.key === 'Escape') {
        if (showShortcutsHelp) { setShowShortcutsHelp(false); return; }
        if (showNewChatDialog) { setShowNewChatDialog(false); return; }
        if (showRoomSettings) { setShowRoomSettings(false); return; }
        if (showLeaveConfirm) { setShowLeaveConfirm(false); return; }
        if (deviceAlertInfo) { setDeviceAlertInfo(null); return; }
        if (keyChangeInfo) { setKeyChangeInfo(null); return; }
        if (isMobile && !sidebarOpen) { setSidebarOpen(true); return; }
        setFocusedRoomIndex(null);
        return;
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && rooms.length > 0) {
        const t = (e.target as HTMLElement)?.tagName;
        if (t === 'INPUT' || t === 'TEXTAREA') return;
        e.preventDefault();
        setFocusedRoomIndex((prev) => {
          const mx = rooms.length - 1;
          if (prev == null) return e.key === 'ArrowDown' ? 0 : mx;
          if (e.key === 'ArrowDown') return prev < mx ? prev + 1 : 0;
          return prev > 0 ? prev - 1 : mx;
        });
        return;
      }
      if (e.key === 'Enter' && focusedRoomIndex != null && rooms.length > 0) {
        const t = (e.target as HTMLElement)?.tagName;
        if (t === 'INPUT' || t === 'TEXTAREA' || t === 'BUTTON') return;
        e.preventDefault();
        if (focusedRoomIndex >= 0 && focusedRoomIndex < rooms.length) {
          // eslint-disable-next-line security/detect-object-injection
          handleSelectRoom(rooms[focusedRoomIndex].roomId);
          setFocusedRoomIndex(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, isMobile, sidebarOpen, rooms, focusedRoomIndex, showShortcutsHelp, showNewChatDialog, showRoomSettings, showLeaveConfirm, deviceAlertInfo, keyChangeInfo]);

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
            showToast('error', 'Failed to load conversations. Check your connection.', {
              dedupeKey: 'room-fetch',
            });
          }
        }

        if (!cancelled) setInitPhase('done');
      } catch (err) {
        console.error('Initialization error:', err);
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Initialization failed';
          setInitError(msg);
          showToast('error', msg, {
            persistent: true,
            dedupeKey: 'init-error',
          });
        }
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [auth, setInitialUnread, requestNotifPermission, showToast]);

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
      showToast('success', 'Conversations loaded', { dedupeKey: 'room-fetch' });
    } catch {
      setRoomFetchError('Failed to load conversations. Check your connection.');
      showToast('error', 'Failed to load conversations. Check your connection.', {
        dedupeKey: 'room-fetch',
      });
    }
  }, [setInitialUnread, showToast]);

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

  // Fade transition style for page switches
  const fadeTransitionStyle: React.CSSProperties = { animation: 'frame-fade-in 0.15s ease-out' };

  // ── Page: Landing ──
  if (currentPage === 'landing') {
    return (
      <div key="page-landing" style={fadeTransitionStyle}>
        <React.Suspense fallback={<div />}>
          <LandingPage onGetStarted={() => setCurrentPage('auth')} />
        </React.Suspense>
        {showInstallBanner && (
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '12px 20px',
            backgroundColor: '#161b22',
            borderTop: '1px solid #30363d',
            zIndex: 1000,
            animation: 'frame-fade-in 0.3s ease-out',
          }}>
            <svg width="20" height="20" viewBox="0 0 64 64" fill="none">
              <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke="#58a6ff" strokeWidth="3" fill="rgba(88,166,255,0.08)" />
              <path d="M26 32l4 4 8-8" stroke="#3fb950" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            <span style={{ fontSize: 14, color: '#c9d1d9', fontFamily: 'system-ui, sans-serif' }}>
              Install F.R.A.M.E. for offline access
            </span>
            <button
              type="button"
              onClick={() => void promptInstall()}
              style={{
                padding: '6px 16px',
                fontSize: 13,
                fontWeight: 600,
                backgroundColor: '#58a6ff',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              Install
            </button>
            <button
              type="button"
              onClick={dismissInstall}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                color: '#8b949e',
                backgroundColor: 'transparent',
                border: '1px solid #30363d',
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              Not now
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Page: Auth ──
  if (currentPage === 'auth') {
    return (
      <div key="page-auth" style={fadeTransitionStyle}>
        <SignInPage
          onAuthenticated={handleAuthenticated}
          onBack={() => setCurrentPage('landing')}
        />
      </div>
    );
  }

  // ── Page: App (not authenticated yet — shouldn't normally happen) ──
  if (!auth) {
    return (
      <div key="page-auth-fallback" style={fadeTransitionStyle}>
        <SignInPage onAuthenticated={handleAuthenticated} onBack={() => setCurrentPage('landing')} />
      </div>
    );
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
          {lockError && <div style={styles.lockErrorBanner}>{DOMPurify.sanitize(lockError, PURIFY_CONFIG)}</div>}
          <label htmlFor="lock-passphrase" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>User ID to unlock</label>
          <input
            id="lock-passphrase"
            type="password"
            style={styles.lockInput}
            value={lockPassphrase}
            onChange={(e) => setLockPassphrase(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleUnlock(); }}
            placeholder="User ID (e.g. @alice:example.com)"
            aria-label="User ID to unlock"
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
              showToast={showToast}
            />
          );
        }

      case 'settings':
        return (
          <div style={styles.settingsContainer}>
            {!settingsVerifyBannerDismissed && deviceAlertInfo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', backgroundColor: 'rgba(210,153,34,0.08)', border: '1px solid rgba(210,153,34,0.3)', borderRadius: 8, marginBottom: 16, width: '100%', maxWidth: 440 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M8 1.5L3 4.5v4c0 3.5 2.1 5.8 5 7 2.9-1.2 5-3.5 5-7v-4L8 1.5z" stroke="#d29922" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
                  <path d="M8 5v3M8 10h.01" stroke="#d29922" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <span style={{ fontSize: 13, color: '#d29922', flex: 1 }}>Verify your device for enhanced security</span>
                <button type="button" onClick={() => setSettingsVerifyBannerDismissed(true)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }} title="Dismiss" aria-label="Dismiss verification banner">&#215;</button>
              </div>
            )}
            <ProfileSettings userId={auth.userId} />
            <div style={{ borderTop: '1px solid #30363d', width: '100%', maxWidth: 440, margin: '8px 0 20px' }} />
            <SessionSettings />
            <div style={{ borderTop: '1px solid #30363d', width: '100%', maxWidth: 440, margin: '8px 0 20px' }} />
            <React.Suspense fallback={<div style={{ padding: 16, color: '#8b949e' }}>Loading devices...</div>}>
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
            </React.Suspense>
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
            <React.Suspense fallback={<div />}>
            <FingerprintUI
              userId={keyChangeInfo?.userId || ''}
              deviceId=""
              publicKey={keyChangeInfo?.newPublicKey || ownPublicKey}
              ownPublicKey={ownPublicKey}
              onVerified={() => setActiveView('chat')}
            />
            </React.Suspense>
          </div>
        );

      case 'link-device':
        return (
          <div style={styles.centeredContainer}>
            <React.Suspense fallback={<div />}>
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
            </React.Suspense>
          </div>
        );

      case 'empty':
      default:
        return renderEmptyState();
    }
  };

  const renderEmptyState = () => {
    if (rooms.length === 0) {
      return (
        <div style={styles.emptyMain}>
          <div style={styles.emptyIcon}>
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <rect x="6" y="10" width="44" height="32" rx="6" stroke="#58a6ff" strokeWidth="2" fill="rgba(88,166,255,0.06)" />
              <path d="M6 16l22 14 22-14" stroke="#58a6ff" strokeWidth="2" fill="none" />
            </svg>
          </div>
          <h2 style={styles.emptyTitle}>Welcome to F.R.A.M.E.</h2>
          <p style={styles.emptySubtitle}>Get started in three simple steps</p>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12, marginTop: 24, width: '100%', maxWidth: 340 }}>
            <button type="button" onClick={() => setShowNewChatDialog(true)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', backgroundColor: 'rgba(88,166,255,0.06)', border: '1px solid #30363d', borderRadius: 10, cursor: 'pointer', textAlign: 'left' as const, fontFamily: 'inherit', transition: 'border-color 0.15s, background-color 0.15s' }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.backgroundColor = 'rgba(88,166,255,0.1)'; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.backgroundColor = 'rgba(88,166,255,0.06)'; }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(88,166,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 3v12M3 9h12" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" /></svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', marginBottom: 2 }}>Create your first conversation</div>
                <div style={{ fontSize: 12, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 4 }}>Click here or press <span style={{ color: '#58a6ff', fontWeight: 500 }}>+ New Chat</span> <span style={{ fontSize: 14 }}>&#8593;</span></div>
              </div>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', backgroundColor: 'rgba(63,185,80,0.04)', border: '1px solid #30363d', borderRadius: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(63,185,80,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="18" viewBox="0 0 16 18" fill="none"><rect x="2" y="7" width="12" height="10" rx="2" stroke="#3fb950" strokeWidth="1.5" fill="none" /><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="#3fb950" strokeWidth="1.5" strokeLinecap="round" fill="none" /></svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', marginBottom: 2 }}>Your messages are encrypted end-to-end</div>
                <div style={{ fontSize: 12, color: '#8b949e' }}>Only you and the recipient can read them</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', backgroundColor: 'rgba(188,140,255,0.04)', border: '1px solid #30363d', borderRadius: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(188,140,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 1.5L3 4.5v4.5c0 4.14 2.56 7.01 6 8.5 3.44-1.49 6-4.36 6-8.5V4.5L9 1.5z" stroke="#bc8cff" strokeWidth="1.5" strokeLinejoin="round" fill="none" /><path d="M6.5 9.5l2 2 3.5-4" stroke="#bc8cff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', marginBottom: 2 }}>Verify your contacts for maximum security</div>
                <div style={{ fontSize: 12, color: '#8b949e' }}>Compare fingerprints to prevent impersonation</div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div style={styles.emptyMain}>
        <div style={styles.emptyIcon}>
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <rect x="6" y="10" width="44" height="32" rx="6" stroke="#30363d" strokeWidth="2" fill="rgba(88,166,255,0.04)" />
            <path d="M6 16l22 14 22-14" stroke="#30363d" strokeWidth="2" fill="none" />
          </svg>
        </div>
        <h2 style={styles.emptyTitle}>Select a conversation</h2>
        <p style={styles.emptySubtitle}>Choose a chat from the sidebar or start a new conversation</p>
        <button type="button" style={styles.emptyNewChatButton} onClick={() => setShowNewChatDialog(true)}>+ New Chat</button>
        <p style={styles.emptyHelpText}>Send encrypted messages to anyone on your server</p>
      </div>
    );
  };

  // ── Layout ──

  const showSidebar = isMobile ? sidebarOpen : true;
  const showMain = isMobile ? !sidebarOpen : true;

  return (
    <div style={styles.appWrapper}>
      {/* Skip to content link for keyboard/screen-reader users */}
      <a
        href="#main-content"
        style={styles.skipToContent}
        onFocus={(e) => { (e.target as HTMLElement).style.top = '8px'; }}
        onBlur={(e) => { (e.target as HTMLElement).style.top = '-100px'; }}
      >
        Skip to content
      </a>
      {/* Session timeout warning */}
      {isWarning && timeRemaining < Infinity && (
        <div style={styles.sessionWarningBanner} onClick={() => resetTimer()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') resetTimer(); }}>
          Session expires in {Math.ceil(timeRemaining / 1000)} seconds — click to stay active
        </div>
      )}
      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <div style={{
        ...styles.appContainer,
        ...(isMobile ? {
          position: 'relative' as const,
          width: '200vw',
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100vw)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        } : {}),
      }}>
      {/* Sidebar — always rendered on mobile for smooth slide */}
      {(showSidebar || isMobile) && (
        <aside style={{
          ...styles.sidebar,
          ...(isMobile ? { ...styles.sidebarMobile, flexShrink: 0 } : {}),
        }}>
          {/* User info — click to open profile settings */}
          <div
            style={styles.userInfo}
            onClick={() => {
              setActiveView('settings');
              if (isMobile) setSidebarOpen(false);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setActiveView('settings');
                if (isMobile) setSidebarOpen(false);
              }
            }}
          >
            <div style={{ position: 'relative' as const, flexShrink: 0 }}>
              <div style={styles.userAvatar}>
                <div style={styles.userAvatarInner}>
                  {auth.userId.charAt(0) === '@'
                    ? auth.userId.charAt(1).toUpperCase()
                    : auth.userId.charAt(0).toUpperCase()}
                </div>
              </div>
              {/* Online status indicator dot on avatar */}
              <div style={{
                position: 'absolute' as const,
                bottom: 1,
                right: 1,
                width: 13,
                height: 13,
                borderRadius: '50%',
                backgroundColor: connectionLost ? '#d29922' : '#3fb950',
                border: '2px solid #161b22',
                transition: 'background-color 0.3s ease',
              }} />
            </div>
            <div style={styles.userDetails}>
              <span style={styles.userName}>{DOMPurify.sanitize(formatDisplayName(auth.userId), PURIFY_CONFIG)}</span>
              <span style={styles.userStatus} role="status" aria-live="polite">
                <span style={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: connectionLost ? '#d29922' : '#3fb950',
                  marginRight: 5,
                  verticalAlign: 'middle',
                }} aria-hidden="true" />
                {connectionLost ? 'Reconnecting...' : 'Online'}
              </span>
              <span style={styles.userDevice}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ marginRight: 4, verticalAlign: 'middle' }}>
                  <path d="M8 1L2 4v4.5c0 3.5 2.5 6.2 6 7.5 3.5-1.3 6-4 6-7.5V4L8 1z" stroke="#3fb950" strokeWidth="1.5" fill="rgba(63,185,80,0.1)" />
                  <path d="M6 8.5l1.5 1.5L10.5 6" stroke="#3fb950" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
                Secured
              </span>
            </div>
            {unreadCount > 0 && (
              <span style={styles.totalUnreadBadge} role="status" aria-live="polite" aria-label={`${unreadCount} unread messages`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>

          {/* Init error -- compact inline indicator (detail shown in toast) */}
          {initError && (
            <div style={styles.initErrorCompact}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="7" cy="7" r="6" stroke="#f85149" strokeWidth="1.2" fill="rgba(248,81,73,0.1)" />
                <path d="M5 5l4 4M9 5l-4 4" stroke="#f85149" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {DOMPurify.sanitize(initError, PURIFY_CONFIG)}
              </span>
            </div>
          )}

          {/* Room fetch error -- compact inline with retry */}
          {roomFetchError && (
            <div style={styles.roomFetchErrorCompact}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="7" cy="7" r="6" stroke="#f85149" strokeWidth="1.2" fill="rgba(248,81,73,0.1)" />
                <path d="M5 5l4 4M9 5l-4 4" stroke="#f85149" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <span style={{ flex: 1, fontSize: 11, color: '#f85149' }}>Load failed</span>
              <button
                type="button"
                style={styles.roomRetryButton}
                onClick={() => void handleRetryRoomFetch()}
              >
                Retry
              </button>
            </div>
          )}

          {/* Room list with scroll fade gradient */}
          <div style={styles.roomListContainer}>
            <RoomList
              rooms={rooms}
              selectedRoomId={selectedRoomId}
              currentUserId={auth.userId}
              onSelectRoom={handleSelectRoom}
              unreadByRoom={unreadByRoom}
              loading={initPhase !== 'done' && rooms.length === 0}
              searchInputRef={searchInputRef}
              focusedRoomIndex={focusedRoomIndex ?? undefined}
            />
            {/* Gradient overlay at the bottom indicating scrollability */}
            <div style={styles.scrollFadeOverlay} />
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
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="2.5" stroke="#8b949e" strokeWidth="1.5" fill="none" />
                <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.34 3.34l1.42 1.42M13.24 13.24l1.42 1.42M3.34 14.66l1.42-1.42M13.24 4.76l1.42-1.42" stroke="#8b949e" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              style={styles.logoutButton}
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M6 15H4a1 1 0 01-1-1V4a1 1 0 011-1h2M12 12l3-3-3-3M7 9h8" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div style={{ position: 'relative' as const }}>
              <button type="button" style={styles.shortcutsHelpButton} onClick={() => setShowShortcutsHelp((v) => !v)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts">?</button>
              {showShortcutsHelp && (
                <div style={styles.shortcutsPopup} role="dialog" aria-label="Keyboard shortcuts">
                  <div style={styles.shortcutsPopupTitle}>Keyboard Shortcuts</div>
                  <div style={styles.shortcutsPopupRow}><kbd style={styles.kbd}>{navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}+K</kbd><span>Search conversations</span></div>
                  <div style={styles.shortcutsPopupRow}><kbd style={styles.kbd}>{navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}+N</kbd><span>New chat</span></div>
                  <div style={styles.shortcutsPopupRow}><kbd style={styles.kbd}>{navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}+,</kbd><span>Settings</span></div>
                  <div style={styles.shortcutsPopupRow}><kbd style={styles.kbd}>Esc</kbd><span>Close / Go back</span></div>
                  <div style={styles.shortcutsPopupRow}><kbd style={styles.kbd}>{'\u2191'}/{'\u2193'}</kbd><span>Navigate rooms</span></div>
                  <div style={styles.shortcutsPopupRow}><kbd style={styles.kbd}>Enter</kbd><span>Select room</span></div>
                </div>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* Main content — always rendered on mobile for smooth slide */}
      {(showMain || isMobile) && (
        <main id="main-content" style={{
          ...styles.mainContent,
          ...(isMobile ? { width: '100vw', minWidth: '100vw', flexShrink: 0 } : {}),
        }}>
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
          <div key={activeView} style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', animation: 'frame-fade-in 0.15s ease-out' }}>
            {renderMainContent()}
          </div>
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
          <div style={styles.leaveModal} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label="Leave conversation confirmation">
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
        <React.Suspense fallback={<div />}>
        <RoomSettings
          room={selectedRoom}
          currentUserId={auth.userId}
          onClose={() => setShowRoomSettings(false)}
          onLeaveRoom={handleLeaveRoomFromSettings}
          onRoomRenamed={handleRoomRenamed}
          onMemberInvited={() => void handleRetryRoomFetch()}
        />
        </React.Suspense>
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
    padding: '18px 16px 14px',
    borderBottom: '1px solid #30363d',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #58a6ff 0%, #3fb950 100%)',
    padding: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 19,
    fontWeight: 700,
    color: '#58a6ff',
    flexShrink: 0,
    boxShadow: '0 0 0 2px #161b22',
  },
  userAvatarInner: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    backgroundColor: '#21262d',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
  userStatus: {
    fontSize: 11,
    color: '#3fb950',
    fontWeight: 500,
  },
  userDevice: {
    fontSize: 10,
    color: '#3fb950',
    display: 'flex',
    alignItems: 'center',
    marginTop: 1,
    opacity: 0.85,
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

  // ── Init error (compact inline) ──
  initErrorCompact: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 12px',
    margin: '6px 12px 0',
    backgroundColor: 'rgba(248, 81, 73, 0.08)',
    borderRadius: 6,
    fontSize: 11,
    color: '#f85149',
  },

  // ── Room fetch error (compact inline) ──
  roomFetchErrorCompact: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 12px',
    margin: '6px 12px 0',
    backgroundColor: 'rgba(248, 81, 73, 0.08)',
    borderRadius: 6,
    fontSize: 11,
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
    position: 'relative' as const,
  },
  scrollFadeOverlay: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: 40,
    background: 'linear-gradient(to bottom, rgba(22, 27, 34, 0), rgba(22, 27, 34, 0.95))',
    pointerEvents: 'none' as const,
    zIndex: 1,
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
    color: '#8b949e',
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
  skipToContent: { position: 'absolute' as const, top: -100, left: 8, zIndex: 10001, padding: '8px 16px', backgroundColor: '#58a6ff', color: '#0d1117', fontSize: 13, fontWeight: 600, borderRadius: 6, textDecoration: 'none', transition: 'top 0.2s ease' },
  shortcutsHelpButton: { padding: '6px 10px', fontSize: 13, fontWeight: 700, backgroundColor: 'transparent', color: '#8b949e', border: '1px solid #30363d', borderRadius: 6, cursor: 'pointer', lineHeight: 1, fontFamily: 'inherit', transition: 'border-color 0.15s, color 0.15s' },
  shortcutsPopup: { position: 'absolute' as const, bottom: 44, right: 0, width: 240, padding: 16, backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 100 },
  shortcutsPopupTitle: { fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #21262d' },
  shortcutsPopupRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: 12, color: '#8b949e' },
  kbd: { display: 'inline-block', padding: '2px 6px', fontSize: 11, fontWeight: 600, fontFamily: 'monospace', color: '#c9d1d9', backgroundColor: '#21262d', border: '1px solid #30363d', borderRadius: 4, lineHeight: '16px' },
};

export default App;
