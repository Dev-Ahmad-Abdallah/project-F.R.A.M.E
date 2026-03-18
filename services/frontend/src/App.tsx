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
import AuthFlow from './components/AuthFlow';
import ChatWindow from './components/ChatWindow';
import DeviceList from './components/DeviceList';
import RoomList from './components/RoomList';
import NewChatDialog from './components/NewChatDialog';
import FingerprintUI from './verification/fingerprintUI';
import DeviceLinking from './devices/deviceLinking';
import DeviceAlert from './devices/deviceAlert';
import type { UnknownDeviceInfo } from './devices/deviceAlert';
import KeyChangeAlert from './verification/keyChangeAlert';
import type { KeyChangeAction } from './verification/keyChangeAlert';
import { clearTokens, getAccessToken } from './api/client';
import { listRooms } from './api/roomsAPI';
import type { RoomSummary } from './api/roomsAPI';
import { generateAndUploadKeys } from './crypto/keyManager';
import { initCrypto, getIdentityKeys } from './crypto/olmMachine';
import { registerServiceWorker } from './notifications';
import { initStorage } from './storage/secureStorage';

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

  // Modal overlay state
  const [deviceAlertInfo, setDeviceAlertInfo] =
    useState<UnknownDeviceInfo | null>(null);
  const [keyChangeInfo, setKeyChangeInfo] = useState<{
    userId: string;
    oldPublicKey: string;
    newPublicKey: string;
  } | null>(null);

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

    let cancelled = false;

    async function initialize() {
      try {
        // 1. Generate and upload device keys (handles initCrypto internally)
        if (!cancelled) setInitPhase('keys');
        await generateAndUploadKeys(auth!.userId, auth!.deviceId);

        // 2. Register service worker for push notifications
        await registerServiceWorker();

        // 3. Init encrypted IndexedDB storage
        if (!cancelled) setInitPhase('storage');
        await initStorage('frame-demo-passphrase');

        // 4. Fetch room list
        if (!cancelled) {
          setInitPhase('rooms');
          try {
            const roomList = await listRooms();
            setRooms(roomList);
            setRoomFetchError(null);
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

    initialize();
    return () => {
      cancelled = true;
    };
  }, [auth]);

  // ── Handlers ──

  const handleLogout = useCallback(() => {
    clearTokens();
    setAuth(null);
    setCurrentPage('landing');
    setActiveView('empty');
    setSelectedRoomId(null);
    setRooms([]);
    setInitError(null);
    setInitPhase('keys');
    setRoomFetchError(null);
  }, []);

  const handleSelectRoom = useCallback(
    (roomId: string) => {
      setSelectedRoomId(roomId);
      setActiveView('chat');
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile],
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

  const handleDeviceAlertVerify = useCallback((_deviceId: string) => {
    setDeviceAlertInfo(null);
    setActiveView('link-device');
  }, []);

  const handleDeviceAlertRemove = useCallback((_deviceId: string) => {
    setDeviceAlertInfo(null);
  }, []);

  const handleDeviceAlertIgnore = useCallback((_deviceId: string) => {
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

  const handleRetryRoomFetch = useCallback(async () => {
    setRoomFetchError(null);
    try {
      const roomList = await listRooms();
      setRooms(roomList);
    } catch {
      setRoomFetchError('Failed to load conversations. Check your connection.');
    }
  }, []);

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

  // ── Initialization overlay ──
  if (initPhase !== 'done' && !initError) {
    const phaseLabels: Record<string, string> = {
      keys: 'Generating encryption keys...',
      storage: 'Initializing secure storage...',
      rooms: 'Loading conversations...',
    };
    return (
      <div style={styles.initOverlay}>
        <div style={styles.initSpinner} />
        <p style={styles.initPhaseText}>{phaseLabels[initPhase] || 'Initializing...'}</p>
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
            chatDisplayName = other?.displayName || other?.userId;
          }
          if (!chatDisplayName && selectedRoom) {
            const names = selectedRoom.members
              .filter((m) => m.userId !== auth.userId)
              .slice(0, 3)
              .map((m) => m.displayName || m.userId);
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
            />
          );
        }

      case 'settings':
        return (
          <div style={styles.settingsContainer}>
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
              onApprove={() => {
                setActiveView('settings');
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
              <span style={styles.userName}>{auth.userId}</span>
              <span style={styles.userDevice}>
                Device: {auth.deviceId.slice(0, 8)}...
              </span>
            </div>
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
                onClick={handleRetryRoomFetch}
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
};

export default App;
