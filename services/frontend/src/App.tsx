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
import DeviceAlert from './devices/deviceAlert';
import type { UnknownDeviceInfo } from './devices/deviceAlert';
import DeviceVerificationGate, {
  deviceNeedsVerification,
  setDeviceVerified,
} from './devices/DeviceVerificationGate';
import { listDevices as listUserDevices } from './api/devicesAPI';
import KeyChangeAlert from './verification/keyChangeAlert';
import type { KeyChangeAction } from './verification/keyChangeAlert';
import { getAccessToken, setApiToastCallback, setSessionExpiredCallback, clearTokens } from './api/client';
import { logout as apiLogout, updateStatus, loginAsGuest } from './api/authAPI';
import { formatDisplayName } from './utils/displayName';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from './utils/purifyConfig';
import { listRooms, leaveRoom } from './api/roomsAPI';
import { getBlockedUsers } from './api/blocksAPI';
import { getKnownDevices, verifyDevice } from './devices/deviceManager';
import type { RoomSummary } from './api/roomsAPI';
import { generateAndUploadKeys } from './crypto/keyManager';
import { getIdentityKeys } from './crypto/olmMachine';
import { invalidateRoomSession } from './crypto/sessionManager';
import { registerServiceWorker, onServiceWorkerUpdateAvailable } from './notifications';
import { initStorage } from './storage/secureStorage';
import { useNotifications } from './hooks/useNotifications';
import { useToast } from './hooks/useToast';
import SessionSettings from './components/SessionSettings';
import ProfileSettings from './components/ProfileSettings';
import { useSessionTimeout, getAutoLock } from './hooks/useSessionTimeout';
import { useInstallPrompt } from './hooks/useInstallPrompt';
import { playNotificationSound } from './sounds';
import { useScreenProtection } from './hooks/useScreenProtection';
import PrivacyShield from './components/PrivacyShield';
import RankBadge from './components/RankBadge';
import RankDisplay from './components/RankDisplay';
import VaultCalculator from './components/VaultCalculator';
import { unlockRank } from './utils/rankSystem';

// Lazy-load components not needed on initial render — reduces main bundle size
const LandingPage = React.lazy(() => import('./pages/LandingPage'));
const DeviceList = React.lazy(() => import('./components/DeviceList'));
const RoomSettings = React.lazy(() => import('./components/RoomSettings'));
const FingerprintUI = React.lazy(() => import('./verification/fingerprintUI'));
const DeviceLinking = React.lazy(() => import('./devices/deviceLinking'));

// ── Types ──

type CurrentPage = 'landing' | 'auth' | 'app';
type ActiveView = 'chat' | 'settings' | 'verify' | 'link-device' | 'empty';

/** Deep link verification parameters extracted from /verify?... URL */
interface DeepLinkVerifyParams {
  userId: string;
  deviceId: string;
  fingerprint: string;
}

/**
 * Parse deep link verify parameters from the current URL.
 * Returns null if not a /verify deep link.
 */
function parseVerifyDeepLink(): DeepLinkVerifyParams | null {
  try {
    const url = new URL(window.location.href);
    if (url.pathname !== '/verify') return null;
    const userId = url.searchParams.get('userId');
    const fingerprint = url.searchParams.get('fingerprint');
    const deviceId = url.searchParams.get('deviceId') ?? '';
    if (!userId || !fingerprint) return null;
    return { userId, deviceId, fingerprint };
  } catch {
    return null;
  }
}

// ── Component ──

function App() {
  // Page-level navigation
  const [currentPage, setCurrentPage] = useState<CurrentPage>(() => {
    // If already authenticated (e.g. token in memory from a soft reload),
    // skip straight to the app shell.
    return getAccessToken() ? 'app' : 'landing';
  });

  const [auth, setAuth] = useState<AuthResponse | null>(null);

  // Deep link verification: when user scans QR and opens /verify?... URL
  const [pendingVerifyLink, setPendingVerifyLink] = useState<DeepLinkVerifyParams | null>(
    () => parseVerifyDeepLink(),
  );

  // Bug 4 fix: Track display name and status separately so sidebar re-renders
  // when the user updates them in ProfileSettings.
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState<string>('online');
  const [userStatusMessage, setUserStatusMessage] = useState<string>('');

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
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [focusedRoomIndex, setFocusedRoomIndex] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  /* eslint-enable @typescript-eslint/no-unused-vars */

  // Lock screen state (auto-lock on inactivity)
  const [isLocked, setIsLocked] = useState(false);
  const [lockPassphrase, setLockPassphrase] = useState('');
  const [lockError, setLockError] = useState<string | null>(null);

  // Vault mode (calculator disguise)
  const [vaultMode, setVaultMode] = useState<boolean>(() =>
    localStorage.getItem('frame-vault-active') === 'true',
  );
  const vaultTapCountRef = useRef(0);
  const vaultTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activateVaultMode = useCallback(() => {
    // First time: prompt user to set their vault PIN
    const existingPin = localStorage.getItem('frame-vault-pin');
    if (!existingPin) {
      const pin = prompt('Set your vault unlock code (numbers only, e.g. 1337):');
      if (!pin || !/^\d{3,8}$/.test(pin.trim())) {
        alert('PIN must be 3-8 digits. Vault not activated.');
        return;
      }
      localStorage.setItem('frame-vault-pin', pin.trim());
    }
    setVaultMode(true);
    localStorage.setItem('frame-vault-active', 'true');
  }, []);

  const deactivateVaultMode = useCallback(() => {
    setVaultMode(false);
    localStorage.removeItem('frame-vault-active');
  }, []);

  /** Triple-tap handler for the sidebar logo to activate vault mode. */
  const handleLogoTap = useCallback(() => {
    vaultTapCountRef.current += 1;
    if (vaultTapTimerRef.current) clearTimeout(vaultTapTimerRef.current);
    if (vaultTapCountRef.current >= 3) {
      vaultTapCountRef.current = 0;
      activateVaultMode();
    } else {
      vaultTapTimerRef.current = setTimeout(() => {
        vaultTapCountRef.current = 0;
      }, 600);
    }
  }, [activateVaultMode]);

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
  const { showBanner: showInstallBanner, promptInstall, dismissBanner: dismissInstall, isIOS } = useInstallPrompt();

  // Screen capture / screenshot protection
  const { isHidden, isBlurred, captureDetected, dismissCaptureWarning } = useScreenProtection();

  // Track previous connection state for reconnection toast
  const prevConnectionLostRef = useRef(false);

  // ── Wire API client toast + session-expired callbacks ──
  useEffect(() => {
    setApiToastCallback(showToast);
    setSessionExpiredCallback((message: string) => {
      // Show login page with a friendly message — never a blank crash
      clearTokens();
      setAuth(null);
      setCurrentPage('landing');
      setActiveView('empty');
      setSelectedRoomId(null);
      setRooms([]);
      setInitError(null);
      setInitPhase('keys');
      setRoomFetchError(null);
      showToast('warning', message, { persistent: true, dedupeKey: 'session-expired' });
    });
  }, [showToast]);

  // ── Auto-reload when a new version is deployed ──
  // When Railway deploys a new build, the service worker detects the new
  // version and fires `controllerchange`, which triggers a page reload.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    }
  }, []);

  // ── Show a clickable toast when a new service worker version is available ──
  useEffect(() => {
    onServiceWorkerUpdateAvailable(() => {
      showToast('info', 'A new version of F.R.A.M.E. is available. Click here to update.', {
        persistent: true,
        dedupeKey: 'sw-update-available',
        onClick: () => {
          window.location.reload();
        },
      });
    });
  }, [showToast]);

  // Settings: dismissible device verification banner
  const [settingsVerifyBannerDismissed, setSettingsVerifyBannerDismissed] = useState(false);

  // Device verification gate: blocks new/unverified devices until verified
  const [showDeviceGate, setShowDeviceGate] = useState(false);

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

  const [unlockLoading, setUnlockLoading] = useState(false);

  const handleUnlock = useCallback(async () => {
    if (!auth) return;
    if (!lockPassphrase) {
      setLockError('Please enter your password');
      return;
    }
    setUnlockLoading(true);
    setLockError(null);
    try {
      // Verify the password against the server login endpoint.
      // We extract the username from the userId (e.g. "@alice:example.com" → "alice").
      const match = auth.userId.match(/^@([^:]+):/);
      const username = match ? match[1] : auth.userId;
      const baseUrl = process.env.REACT_APP_HOMESERVER_URL ?? 'http://localhost:3000';
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: lockPassphrase }),
      });
      if (res.ok) {
        setIsLocked(false);
        setLockPassphrase('');
        setLockError(null);
        resetTimer();
      } else {
        setLockError('Invalid password — please try again');
      }
    } catch {
      setLockError('Unable to verify credentials — check your connection');
    } finally {
      setUnlockLoading(false);
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
        // Immediately sync room list on reconnection so the user sees
        // any rooms/messages they missed while offline — no refresh needed.
        if (auth) {
          void listRooms().then((roomList) => {
            setRooms(roomList);
            setRoomFetchError(null);
          }).catch(() => {
            // Will be retried by the periodic refresh below
          });
        }
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
  }, [showToast, auth]);

  // ── Fetch blocked users on login ──
  const refreshBlockedUsers = useCallback(() => {
    if (!auth) return;
    getBlockedUsers()
      .then((users) => setBlockedUserIds(new Set(users)))
      .catch(() => { /* ignore — endpoint may not exist yet */ });
  }, [auth]);

  useEffect(() => {
    refreshBlockedUsers();
  }, [refreshBlockedUsers]);

  // ── Periodic room list auto-refresh (every 15s) ──
  // Keeps the sidebar fresh without requiring manual reload.
  // Tracks previous unread count to detect new messages and play notification sounds.
  const prevUnreadCountRef = useRef(0);

  useEffect(() => {
    prevUnreadCountRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    if (!auth) return;
    const interval = setInterval(() => {
      if (!navigator.onLine) return; // Skip while offline
      void listRooms().then((roomList) => {
        // Sort rooms by most recent activity (latest message timestamp first)
        roomList.sort((a, b) => {
          const timeA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
          const timeB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
          return timeB - timeA;
        });
        // Merge: keep optimistically-added rooms not yet returned by server
        setRooms((prev) => {
          const serverIds = new Set(roomList.map((r) => r.roomId));
          const optimistic = prev.filter((r) => !serverIds.has(r.roomId));
          return [...roomList, ...optimistic];
        });
        setRoomFetchError(null);

        // Update unread counts from server data
        const freshUnread: Record<string, number> = {};
        let totalFresh = 0;
        for (const r of roomList) {
          if (r.unreadCount > 0) {
            freshUnread[r.roomId] = r.unreadCount;
            totalFresh += r.unreadCount;
          }
        }
        setInitialUnread(freshUnread);

        // Play notification sound when unread count increases while tab is hidden
        if (totalFresh > prevUnreadCountRef.current && document.visibilityState === 'hidden') {
          playNotificationSound();
        }
      }).catch(() => {
        // Silently ignore — will retry on next tick
      });
    }, 15_000);
    return () => clearInterval(interval);
  }, [auth, setInitialUnread]);

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
        @keyframes frame-slide-up {
          0% { opacity: 0; transform: translateY(100%); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes frame-gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes frame-pulse-glow {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.05); }
        }
        @keyframes frame-tip-fade {
          0% { opacity: 0; transform: translateY(8px); }
          12% { opacity: 1; transform: translateY(0); }
          88% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-8px); }
        }
        @media (max-width: 600px) {
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

  // Mobile detection — only used for behavioral changes (overlay sidebar),
  // NOT for layout toggling. Layout is handled by fluid CSS.
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth < 600,
  );

  useEffect(() => {
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const mobile = window.innerWidth < 600;
        setIsMobile(mobile);
        if (!mobile) {
          setSidebarOpen(true);
        }
      }, 100);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, []);

  // ── Swipe-to-close gesture for mobile sidebar ──
  const sidebarRef = useRef<HTMLElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchCurrentX = useRef<number | null>(null);

  useEffect(() => {
    if (!isMobile) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    const onTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
      touchCurrentX.current = e.touches[0].clientX;
      sidebar.style.transition = 'none';
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchStartX.current === null) return;
      touchCurrentX.current = e.touches[0].clientX;
      const dx = touchCurrentX.current - touchStartX.current;
      if (dx < 0) {
        sidebar.style.transform = `translateX(${dx}px)`;
      }
    };

    const onTouchEnd = () => {
      if (touchStartX.current === null || touchCurrentX.current === null) return;
      const dx = touchCurrentX.current - touchStartX.current;
      sidebar.style.transition = '';
      sidebar.style.transform = '';
      if (dx < -80) {
        setSidebarOpen(false);
      }
      touchStartX.current = null;
      touchCurrentX.current = null;
    };

    sidebar.addEventListener('touchstart', onTouchStart, { passive: true });
    sidebar.addEventListener('touchmove', onTouchMove, { passive: true });
    sidebar.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      sidebar.removeEventListener('touchstart', onTouchStart);
      sidebar.removeEventListener('touchmove', onTouchMove);
      sidebar.removeEventListener('touchend', onTouchEnd);
    };
  }, [isMobile, sidebarOpen]);

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
    // Use capture phase to intercept shortcuts before browser defaults (e.g. Ctrl+N)
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, isMobile, sidebarOpen, rooms, focusedRoomIndex, showShortcutsHelp, showNewChatDialog, showRoomSettings, showLeaveConfirm, deviceAlertInfo, keyChangeInfo]);

  // ── Auth handler ──

  const handleAuthenticated = useCallback((authResponse: AuthResponse) => {
    setAuth(authResponse);
    setCurrentPage('app');
    // If there's a pending verify deep link, jump straight to link-device view
    // after login completes (the post-login init effect will handle the rest).
  }, []);

  const handleGuestLogin = useCallback(async () => {
    try {
      const guestData = await loginAsGuest();
      const authResponse: AuthResponse = {
        accessToken: guestData.accessToken,
        refreshToken: '',
        userId: guestData.userId,
        deviceId: guestData.deviceId,
        homeserver: guestData.homeserver,
        guest: true,
      };
      handleAuthenticated(authResponse);
    } catch {
      showToast('error', 'Could not start a guest session. Please try again or create an account.', { dedupeKey: 'guest-login-fail' });
    }
  }, [handleAuthenticated, showToast]);

  // ── Post-login initialization ──

  useEffect(() => {
    if (!auth) return;
    const currentAuth = auth; // Capture for closure narrowing

    let cancelled = false;

    async function initialize() {
      try {
        // SECURITY: ALL sessions (including guests) MUST initialize crypto.
        // E2EE is the core security promise — no user type gets a plaintext path.
        // Guest sessions use the same OlmMachine + key generation as regular users;
        // they just have shorter-lived tokens and skip service worker registration.

        // 1. Generate and upload device keys (handles initCrypto internally)
        if (!cancelled) setInitPhase('keys');
        await generateAndUploadKeys(currentAuth.userId, currentAuth.deviceId);

        if (!currentAuth.guest) {
          // 2. Register service worker for push notifications (skip for guests)
          await registerServiceWorker();
        }

        // 3. Init encrypted IndexedDB storage with a user-derived passphrase.
        //    We hash `userId + ":" + accessToken + ":frame-storage"` with SHA-256
        //    to produce a per-session passphrase that can't be derived from
        //    the public userId alone.
        if (!cancelled) setInitPhase('storage');
        const currentAccessToken = getAccessToken() ?? '';
        const passphraseData = new TextEncoder().encode(
          currentAuth.userId + ':' + currentAccessToken + ':frame-storage',
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

        if (!cancelled) {
          setInitPhase('done');

          // Check device verification status from the server on each app load.
          // If this is the user's only device, auto-verify it (no gate needed).
          // If there are other devices, the gate blocks until verification.
          // First check localStorage for a previously persisted verification.
          let locallyVerified = false;
          try {
            locallyVerified = localStorage.getItem(`frame-device-verified:${currentAuth.deviceId}`) === 'true';
          } catch { /* localStorage may be unavailable */ }

          if (!locallyVerified && await deviceNeedsVerification(currentAuth.deviceId, currentAuth.userId)) {
            try {
              const deviceListResp = await listUserDevices(currentAuth.userId);
              const deviceCount = deviceListResp.devices?.length ?? 0;
              if (deviceCount <= 1) {
                // First/only device — auto-verify on server, no gate
                await setDeviceVerified(currentAuth.deviceId);
                try { localStorage.setItem(`frame-device-verified:${currentAuth.deviceId}`, 'true'); } catch { /* */ }
              } else {
                // Multiple devices — must verify
                setShowDeviceGate(true);
              }
            } catch {
              // If device list fetch fails, show the gate to be safe
              setShowDeviceGate(true);
            }
          }
        }
      } catch (err) {
        console.error('Initialization error:', err);
        if (!cancelled) {
          const msg = 'Failed to initialize. Please refresh the page or try again later.';
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

  // ── Deep link verification handler ──
  // When the app loads from a /verify?... URL and the user is authenticated,
  // auto-navigate to the link-device view with pre-filled data.
  useEffect(() => {
    if (!auth || !pendingVerifyLink) return;
    // Wait until init is done so crypto keys are available
    if (initPhase !== 'done') return;

    // Auto-approve the device verification from the deep link
    void (async () => {
      try {
        const knownDevices = await getKnownDevices(auth.userId);
        const matched = knownDevices.find(
          (d) => d.fingerprint === pendingVerifyLink.fingerprint,
        );
        if (matched) {
          await verifyDevice(auth.userId, matched.deviceId);
          showToast('success', `Device verified successfully`, { dedupeKey: 'deep-link-verify' });
        } else {
          // No exact match — show the link-device view for manual confirmation
          setActiveView('link-device');
          showToast('info', 'Scan received — please confirm the device fingerprint', { dedupeKey: 'deep-link-verify' });
        }
      } catch (err) {
        console.error('Deep link verification failed:', err);
        setActiveView('link-device');
      }
      // Clear the deep link params from the URL to avoid re-triggering
      setPendingVerifyLink(null);
      try {
        window.history.replaceState({}, '', '/');
      } catch { /* ignore */ }
    })();
  }, [auth, pendingVerifyLink, initPhase, showToast]);

  // ── Presence heartbeat ──
  // Refresh the current user's "online" status in Redis every 2 minutes
  // so the 5-minute TTL doesn't expire while the app is open.
  useEffect(() => {
    if (!auth) return;
    let cancelled = false;

    const sendHeartbeat = async () => {
      try {
        await updateStatus('online');
      } catch {
        // Silently ignore — status is best-effort
      }
    };

    // Send immediately on login
    void sendHeartbeat();
    // Then refresh every 2 minutes (well within the 5-minute Redis TTL)
    const interval = setInterval(() => {
      if (!cancelled) void sendHeartbeat();
    }, 120_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      // Set offline on unmount (logout / tab close)
      void updateStatus('offline').catch(() => { /* best-effort */ });
    };
  }, [auth]);

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

  // Rotating tips for empty state
  const QUICK_TIPS = [
    'Tip: Star important conversations to pin them at the top',
    'Tip: Use view-once for sensitive messages that self-destruct',
    'Tip: Right-click any message to reply, forward, or delete',
    'Tip: Press Cmd+K to quickly search conversations',
    'Tip: Verify contacts by comparing fingerprints',
  ];

  const [currentTipIndex, setCurrentTipIndex] = useState(0);

  useEffect(() => {
    const tipTimer = setInterval(() => {
      setCurrentTipIndex((prev) => (prev + 1) % QUICK_TIPS.length);
    }, 5000);
    return () => clearInterval(tipTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fade transition style for page switches
  const fadeTransitionStyle: React.CSSProperties = { animation: 'frame-fade-in 0.15s ease-out' };

  // ── Deep link redirect: if user is not logged in but has a /verify deep link,
  // send them to auth so they can log in first; the pending params are preserved. ──
  if (currentPage === 'landing' && pendingVerifyLink) {
    return (
      <div key="page-auth-deeplink" style={fadeTransitionStyle}>
        <SignInPage
          onAuthenticated={handleAuthenticated}
          onBack={() => { setPendingVerifyLink(null); try { window.history.replaceState({}, '', '/'); } catch { /* ignore */ } setCurrentPage('landing'); }}
        />
      </div>
    );
  }

  // ── Page: Landing ──
  if (currentPage === 'landing') {
    return (
      <div key="page-landing" style={fadeTransitionStyle}>
        <React.Suspense fallback={<div />}>
          <LandingPage onGetStarted={() => setCurrentPage('auth')} onTryAsGuest={() => void handleGuestLogin()} />
        </React.Suspense>
        {showInstallBanner && (
          <>
            {/* Backdrop overlay */}
            <div
              onClick={dismissInstall}
              style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.5)',
                zIndex: 999,
                animation: 'frame-fade-in 0.2s ease-out',
              }}
            />
            {/* Bottom sheet */}
            <div style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '24px 20px max(24px, env(safe-area-inset-bottom))',
              backgroundColor: '#161b22',
              borderTop: '1px solid #30363d',
              borderRadius: '16px 16px 0 0',
              zIndex: 1000,
              animation: 'frame-slide-up 0.3s ease-out',
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            }}>
              {/* Drag handle */}
              <div style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: '#30363d',
                marginBottom: 20,
              }} />
              {/* App icon */}
              <div style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                backgroundColor: 'rgba(88,166,255,0.08)',
                border: '1px solid rgba(88,166,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}>
                <svg width="32" height="32" viewBox="0 0 64 64" fill="none">
                  <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke="#58a6ff" strokeWidth="3" fill="rgba(88,166,255,0.08)" />
                  <path d="M26 32l4 4 8-8" stroke="#3fb950" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </div>
              {/* Title */}
              <span style={{ fontSize: 17, fontWeight: 600, color: '#f0f6fc', marginBottom: 6 }}>
                Add to Home Screen
              </span>
              <span style={{ fontSize: 14, color: '#8b949e', marginBottom: 20, textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
                {isIOS
                  ? 'Install F.R.A.M.E. for quick access and offline use'
                  : 'Install F.R.A.M.E. for offline access and push notifications'}
              </span>
              {/* iOS instructions or Android install button */}
              {isIOS ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  width: '100%',
                  maxWidth: 300,
                  marginBottom: 16,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8,
                      backgroundColor: 'rgba(88,166,255,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M12 5v10M8 9l4-4 4 4" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <rect x="4" y="14" width="16" height="6" rx="1" stroke="#58a6ff" strokeWidth="2" fill="none" />
                      </svg>
                    </div>
                    <span style={{ fontSize: 14, color: '#c9d1d9' }}>
                      Tap the <strong style={{ color: '#58a6ff' }}>Share</strong> button in Safari
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8,
                      backgroundColor: 'rgba(88,166,255,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <rect x="3" y="3" width="18" height="18" rx="4" stroke="#58a6ff" strokeWidth="2" fill="none" />
                        <path d="M12 8v8M8 12h8" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <span style={{ fontSize: 14, color: '#c9d1d9' }}>
                      Scroll down and tap <strong style={{ color: '#58a6ff' }}>Add to Home Screen</strong>
                    </span>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void promptInstall()}
                  style={{
                    width: '100%',
                    maxWidth: 300,
                    padding: '14px 24px',
                    fontSize: 15,
                    fontWeight: 600,
                    backgroundColor: '#58a6ff',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    marginBottom: 8,
                  }}
                >
                  Install App
                </button>
              )}
              <button
                type="button"
                onClick={dismissInstall}
                style={{
                  width: '100%',
                  maxWidth: 300,
                  padding: '12px 24px',
                  fontSize: 14,
                  color: '#8b949e',
                  backgroundColor: 'transparent',
                  border: '1px solid #30363d',
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Not now
              </button>
            </div>
          </>
        )}
        {/* Toast notifications (needed for guest login errors on landing page) */}
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
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
        <div className="frame-lock-card" style={styles.lockCard}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ marginBottom: 16 }}>
            <rect x="10" y="22" width="28" height="20" rx="4" stroke="#58a6ff" strokeWidth="2" fill="rgba(88,166,255,0.06)" />
            <path d="M16 22v-6a8 8 0 0116 0v6" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" />
            <circle cx="24" cy="33" r="2" fill="#58a6ff" />
          </svg>
          <h2 style={styles.lockTitle}>Session Locked</h2>
          <p style={styles.lockSubtitle}>Enter your account password to unlock</p>
          {lockError && <div style={styles.lockErrorBanner}>{DOMPurify.sanitize(lockError, PURIFY_CONFIG)}</div>}
          <label htmlFor="lock-passphrase" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>Password to unlock</label>
          <input
            id="lock-passphrase"
            type="password"
            className="frame-lock-input"
            style={styles.lockInput}
            value={lockPassphrase}
            onChange={(e) => setLockPassphrase(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleUnlock(); }}
            placeholder="Password"
            aria-label="Password to unlock"
            autoFocus
            disabled={unlockLoading}
          />
          <div className="frame-lock-actions" style={styles.lockActions}>
            <button type="button" style={styles.lockUnlockButton} onClick={() => void handleUnlock()} disabled={unlockLoading}>{unlockLoading ? 'Verifying...' : 'Unlock'}</button>
            <button type="button" style={styles.lockLogoutButton} onClick={handleLogout}>Log out</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Vault mode (calculator disguise) ──
  if (vaultMode) {
    return <VaultCalculator onUnlock={deactivateVaultMode} />;
  }

  // ── Device verification gate ──
  // Shown after init is complete, blocks access until verified or skipped.
  // Must render BEFORE the main app layout so it overlays everything.

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
          // Derive display name for the room header — check local nickname first
          const localNickname = (() => { try { return localStorage.getItem(`frame-room-nickname:${selectedRoomId}`); } catch { return null; } })();
          let chatDisplayName: string | undefined = localNickname || selectedRoom?.name;
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
              isAnonymous={selectedRoom?.isAnonymous}
              onOpenSettings={handleOpenRoomSettings}
              onRoomRenamed={handleRoomRenamed}
              onLeave={() => setShowLeaveConfirm(true)}
              showToast={showToast}
              blockedUserIds={blockedUserIds}
              onBlockStatusChanged={refreshBlockedUsers}
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
            <ProfileSettings userId={auth.userId} onDisplayNameChange={setUserDisplayName} onStatusChange={setUserStatus} onStatusMessageChange={setUserStatusMessage} />
            <div style={{ borderTop: '1px solid rgba(48, 54, 61, 0.6)', width: '100%', maxWidth: 440, margin: '12px 0 24px' }} />
            <SessionSettings onActivateVault={activateVaultMode} />
            <div style={{ borderTop: '1px solid rgba(48, 54, 61, 0.6)', width: '100%', maxWidth: 440, margin: '12px 0 24px' }} />
            <RankDisplay />
            <div style={{ borderTop: '1px solid rgba(48, 54, 61, 0.6)', width: '100%', maxWidth: 440, margin: '12px 0 24px' }} />
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
              deviceId={auth.deviceId}
              userId={auth.userId}
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
                    // Mark current device as verified on the server and locally
                    await setDeviceVerified(auth.deviceId);
                    try {
                      localStorage.setItem(`frame-device-verified:${auth.deviceId}`, 'true');
                    } catch { /* localStorage may be unavailable */ }
                    setShowDeviceGate(false);
                    unlockRank('operator');
                  } catch (err) {
                    console.error('Failed to verify linked device:', err);
                  }
                  setActiveView('chat');
                })();
              }}
              onReject={() => {
                // If the gate is active, don't allow bypassing to settings
                if (showDeviceGate) {
                  setActiveView('empty');
                } else {
                  setActiveView('settings');
                }
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
        <div style={{ ...styles.emptyMain, position: 'relative' as const, overflow: 'hidden' }}>
          {/* Subtle animated gradient background */}
          <div style={{
            position: 'absolute' as const,
            inset: 0,
            background: 'radial-gradient(ellipse at 30% 20%, rgba(88,166,255,0.06) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(63,185,80,0.04) 0%, transparent 50%)',
            animation: 'frame-gradient-shift 8s ease-in-out infinite',
            backgroundSize: '200% 200%',
            pointerEvents: 'none' as const,
          }} />
          <div style={{ position: 'relative' as const, zIndex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center' }}>
            <div style={styles.emptyIcon}>
              <svg width="56" height="56" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke="#58a6ff" strokeWidth="2" fill="rgba(88,166,255,0.06)" />
                <path d="M26 32l4 4 8-8" stroke="#3fb950" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </div>
            <h2 style={{ ...styles.emptyTitle, background: 'linear-gradient(135deg, #58a6ff 0%, #c9d1d9 40%, #f0f6fc 60%, #58a6ff 100%)', backgroundSize: '200% 200%', animation: 'frame-gradient-shift 6s ease infinite', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Welcome to F.R.A.M.E.</h2>
            <p style={styles.emptySubtitle}>Get started in three simple steps</p>

            {/* Pulsing encryption indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 8 }}>
              <div style={{ animation: 'frame-pulse-glow 2s ease-in-out infinite' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="2" y="6" width="10" height="7" rx="1.5" stroke="#3fb950" strokeWidth="1.2" fill="rgba(63,185,80,0.1)" />
                  <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="#3fb950" strokeWidth="1.2" strokeLinecap="round" fill="none" />
                </svg>
              </div>
              <span style={{ fontSize: 11, color: '#3fb950', fontWeight: 500, opacity: 0.8 }}>Encryption active</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10, marginTop: 20, width: '100%', maxWidth: 360 }}>
              <button type="button" onClick={() => setShowNewChatDialog(true)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', backgroundColor: 'rgba(88,166,255,0.04)', border: '1px solid rgba(48,54,61,0.8)', borderRadius: 12, cursor: 'pointer', textAlign: 'left' as const, fontFamily: 'inherit', transition: 'border-color 0.2s, background-color 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(88,166,255,0.4)'; e.currentTarget.style.backgroundColor = 'rgba(88,166,255,0.08)'; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(48,54,61,0.8)'; e.currentTarget.style.backgroundColor = 'rgba(88,166,255,0.04)'; }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(88,166,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 3v12M3 9h12" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" /></svg>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', marginBottom: 3 }}>Create your first conversation</div>
                  <div style={{ fontSize: 12, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 4 }}>Click here or press <span style={{ color: '#58a6ff', fontWeight: 500 }}>+ New Chat</span></div>
                </div>
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', backgroundColor: 'rgba(63,185,80,0.03)', border: '1px solid rgba(48,54,61,0.8)', borderRadius: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(63,185,80,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="16" height="18" viewBox="0 0 16 18" fill="none"><rect x="2" y="7" width="12" height="10" rx="2" stroke="#3fb950" strokeWidth="1.5" fill="none" /><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="#3fb950" strokeWidth="1.5" strokeLinecap="round" fill="none" /></svg>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', marginBottom: 3 }}>Your messages are encrypted end-to-end</div>
                  <div style={{ fontSize: 12, color: '#8b949e' }}>Only you and the recipient can read them</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', backgroundColor: 'rgba(188,140,255,0.03)', border: '1px solid rgba(48,54,61,0.8)', borderRadius: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(188,140,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 1.5L3 4.5v4.5c0 4.14 2.56 7.01 6 8.5 3.44-1.49 6-4.36 6-8.5V4.5L9 1.5z" stroke="#bc8cff" strokeWidth="1.5" strokeLinejoin="round" fill="none" /><path d="M6.5 9.5l2 2 3.5-4" stroke="#bc8cff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', marginBottom: 3 }}>Verify your contacts for maximum security</div>
                  <div style={{ fontSize: 12, color: '#8b949e' }}>Compare fingerprints to prevent impersonation</div>
                </div>
              </div>
            </div>

            {/* Rotating quick tips */}
            <div key={currentTipIndex} style={{ marginTop: 28, fontSize: 12, color: '#6e7681', fontStyle: 'italic', animation: 'frame-tip-fade 5s ease-in-out forwards', textAlign: 'center' as const, maxWidth: 320, lineHeight: 1.5 }}>
              {/* eslint-disable-next-line security/detect-object-injection */}
              {QUICK_TIPS[currentTipIndex]}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div style={{ ...styles.emptyMain, position: 'relative' as const, overflow: 'hidden' }}>
        {/* Subtle animated gradient background */}
        <div style={{
          position: 'absolute' as const,
          inset: 0,
          background: 'radial-gradient(ellipse at 40% 30%, rgba(88,166,255,0.04) 0%, transparent 50%), radial-gradient(ellipse at 60% 70%, rgba(63,185,80,0.03) 0%, transparent 50%)',
          animation: 'frame-gradient-shift 10s ease-in-out infinite',
          backgroundSize: '200% 200%',
          pointerEvents: 'none' as const,
        }} />
        <div style={{ position: 'relative' as const, zIndex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center' }}>
          <div style={styles.emptyIcon}>
            <svg width="48" height="48" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke="#30363d" strokeWidth="2" fill="rgba(88,166,255,0.03)" />
              <path d="M26 32l4 4 8-8" stroke="#30363d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          <h2 style={styles.emptyTitle}>Select a conversation</h2>
          <p style={styles.emptySubtitle}>Choose a chat from the sidebar or start a new conversation</p>

          {/* Pulsing encryption indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 6 }}>
            <div style={{ animation: 'frame-pulse-glow 2s ease-in-out infinite' }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <rect x="2" y="6" width="10" height="7" rx="1.5" stroke="#3fb950" strokeWidth="1.2" fill="rgba(63,185,80,0.1)" />
                <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="#3fb950" strokeWidth="1.2" strokeLinecap="round" fill="none" />
              </svg>
            </div>
            <span style={{ fontSize: 10, color: '#3fb950', opacity: 0.7 }}>All conversations are encrypted</span>
          </div>

          <button type="button" style={styles.emptyNewChatButton} onClick={() => setShowNewChatDialog(true)}>+ New Chat</button>
          <p style={styles.emptyHelpText}>Send encrypted messages to anyone on your server</p>

          {/* Rotating quick tips */}
          <div key={currentTipIndex} style={{ marginTop: 20, fontSize: 12, color: '#6e7681', fontStyle: 'italic', animation: 'frame-tip-fade 5s ease-in-out forwards', textAlign: 'center' as const, maxWidth: 300, lineHeight: 1.5 }}>
            {/* eslint-disable-next-line security/detect-object-injection */}
            {QUICK_TIPS[currentTipIndex]}
          </div>
        </div>
      </div>
    );
  };

  // ── Layout ──

  // On mobile (<600px), sidebar is an overlay — main content is always visible.
  // On desktop, sidebar is always visible alongside main content.
  const showSidebar = isMobile ? sidebarOpen : true;
  const showMain = true; // Always show main content

  return (
    <div style={styles.appWrapper}>
      <PrivacyShield
        isHidden={isHidden}
        isBlurred={isBlurred}
        captureDetected={captureDetected}
        onDismissCaptureWarning={dismissCaptureWarning}
      />
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
        <div className="frame-session-warning" style={styles.sessionWarningBanner} onClick={() => resetTimer()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') resetTimer(); }}>
          Session expires in {Math.ceil(timeRemaining / 1000)}s — {isMobile ? 'tap' : 'click'} to stay active
        </div>
      )}
      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />



      {/* Guest mode banner */}
      {auth.guest && (
        <div className="frame-guest-banner" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '10px 16px',
          backgroundColor: 'rgba(88,166,255,0.08)',
          borderBottom: '1px solid rgba(88,166,255,0.2)',
          fontSize: 13,
          color: '#c9d1d9',
          flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="8" cy="8" r="7" stroke="#58a6ff" strokeWidth="1.2" fill="rgba(88,166,255,0.1)" />
            <path d="M8 5v3.5M8 10.5v.5" stroke="#58a6ff" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span>You are in <strong style={{ color: '#f0f6fc' }}>guest mode</strong> — some features are limited and messages are temporary.</span>
          <button
            type="button"
            onClick={() => {
              handleLogout();
              setCurrentPage('auth');
            }}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: '#238636',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap' as const,
              transition: 'background-color 0.15s ease',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
          >
            Create Account
          </button>
        </div>
      )}

      <div style={styles.appContainer}>
      {/* Mobile sidebar backdrop overlay */}
      {isMobile && (
        <div
          className={sidebarOpen ? 'frame-sidebar-backdrop' : 'frame-sidebar-backdrop frame-sidebar-backdrop-hidden'}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Sidebar — fluid width via CSS class, overlay on mobile */}
      {(showSidebar || isMobile) && (
        <aside
          ref={sidebarRef}
          className={`frame-sidebar${isMobile && !sidebarOpen ? ' frame-sidebar-hidden' : ''}`}
          style={{ flexShrink: isMobile ? undefined : 0, overflow: 'hidden' }}
        >
          {/* Tactical grid + scan-line overlays -- skip on mobile for perf */}
          {!isMobile && <><div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
            backgroundImage: 'linear-gradient(rgba(63,185,80,0.01) 1px, transparent 1px), linear-gradient(90deg, rgba(63,185,80,0.01) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }} /><div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
            background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(63,185,80,0.008) 3px, rgba(63,185,80,0.008) 4px)',
          }} /><div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
            background: 'linear-gradient(180deg, rgba(63,185,80,0.02) 0%, transparent 8%, transparent 92%, rgba(63,185,80,0.02) 100%)',
            animation: 'frame-scanline 10s linear infinite', opacity: 0.4,
          }} /></>}
          {/* F.R.A.M.E. sidebar header branding — triple-tap activates vault mode */}
          <div
            style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #21262d', cursor: 'default' }}
            onClick={handleLogoTap}
            role="banner"
          >
            <svg width="16" height="16" viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke="#3fb950" strokeWidth="3" fill="rgba(63,185,80,0.06)" />
              <path d="M26 32l4 4 8-8" stroke="#3fb950" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 3, color: '#3fb950', fontFamily: '"SF Mono", "Fira Code", monospace', textTransform: 'uppercase' as const }}>F.R.A.M.E.</span>
            <span style={{ fontSize: 9, fontWeight: 500, color: '#484f58', letterSpacing: '0.05em', marginLeft: 'auto' }}>SECURE</span>
          </div>
          {/* User info — click to open profile settings */}
          <div
            className="frame-user-info"
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
              <div className="frame-user-avatar" style={styles.userAvatar}>
                <div className="frame-user-avatar-inner" style={styles.userAvatarInner}>
                  {auth.userId.charAt(0) === '@'
                    ? auth.userId.charAt(1).toUpperCase()
                    : auth.userId.charAt(0).toUpperCase()}
                </div>
              </div>
              {/* Online status indicator dot on avatar */}
              <div style={{
                position: 'absolute' as const,
                bottom: 0,
                right: 0,
                width: 11,
                height: 11,
                borderRadius: '50%',
                backgroundColor: connectionLost ? '#d29922' : (userStatus === 'busy' ? '#f85149' : userStatus === 'away' ? '#d29922' : userStatus === 'offline' ? '#484f58' : '#3fb950'),
                border: '2px solid #161b22',
                transition: 'background-color 0.3s ease',
              }} />
            </div>
            <div style={styles.userDetails}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="frame-user-name" style={styles.userName}>{DOMPurify.sanitize(userDisplayName || formatDisplayName(auth.userId), PURIFY_CONFIG)}</span>
                <RankBadge />
              </div>
              <span className="frame-user-status" style={{ ...styles.userStatus, color: connectionLost ? '#d29922' : (userStatus === 'online' ? '#3fb950' : userStatus === 'away' ? '#d29922' : userStatus === 'busy' ? '#f85149' : '#484f58') }} role="status" aria-live="polite">
                <span style={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: connectionLost ? '#d29922' : (userStatus === 'busy' ? '#f85149' : userStatus === 'away' ? '#d29922' : '#3fb950'),
                  marginRight: 5,
                  verticalAlign: 'middle',
                }} aria-hidden="true" />
                {connectionLost ? 'Reconnecting...' : (userStatus === 'online' ? 'Online' : userStatus === 'away' ? 'Away' : userStatus === 'busy' ? 'Busy' : userStatus === 'offline' ? 'Offline' : 'Online')}
              </span>
              {userStatusMessage && (
                <span style={{ fontSize: 11, color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: '100%', display: 'block', lineHeight: '14px' }} title={userStatusMessage}>
                  {userStatusMessage}
                </span>
              )}
              <span className="frame-user-device" style={styles.userDevice}>
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
              rooms={(() => { const seen = new Set<string>(); return rooms.filter((r) => { if (seen.has(r.roomId)) return false; seen.add(r.roomId); return true; }); })()}
              selectedRoomId={selectedRoomId}
              currentUserId={auth.userId}
              onSelectRoom={handleSelectRoom}
              unreadByRoom={unreadByRoom}
              loading={initPhase !== 'done' && rooms.length === 0}
              searchInputRef={searchInputRef}
              focusedRoomIndex={focusedRoomIndex ?? undefined}
              showToast={showToast}
            />
            {/* Gradient overlay at the bottom indicating scrollability */}
            <div style={styles.scrollFadeOverlay} />
          </div>

          {/* Bottom actions — tab bar on mobile, row on desktop */}
          <div className={isMobile ? 'frame-sidebar-actions-mobile' : ''} style={isMobile ? undefined : styles.sidebarActions}>
            <button
              type="button"
              style={isMobile ? undefined : styles.newChatButton}
              onClick={() => setShowNewChatDialog(true)}
              aria-label="New Chat"
              title="New Chat"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 4v12M4 10h12" stroke={isMobile ? '#8b949e' : '#ffffff'} strokeWidth="2" strokeLinecap="round" />
              </svg>
              {isMobile && <span>New Chat</span>}
              {!isMobile && ' New Chat'}
            </button>
            <button
              type="button"
              style={isMobile ? undefined : styles.settingsButton}
              onClick={() => {
                setActiveView('settings');
                if (isMobile) setSidebarOpen(false);
              }}
              aria-label="Settings"
              title="Settings"
            >
              <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="2.5" stroke="#8b949e" strokeWidth="1.5" fill="none" />
                <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.34 3.34l1.42 1.42M13.24 13.24l1.42 1.42M3.34 14.66l1.42-1.42M13.24 4.76l1.42-1.42" stroke="#8b949e" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {isMobile && <span>Settings</span>}
            </button>
            <button
              type="button"
              style={isMobile ? undefined : styles.logoutButton}
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
            >
              <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M6 15H4a1 1 0 01-1-1V4a1 1 0 011-1h2M12 12l3-3-3-3M7 9h8" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {isMobile && <span>Log out</span>}
            </button>
            {!isMobile && (
              <div style={{ position: 'relative' as const }}>
                <button type="button" className="frame-shortcuts-btn" style={styles.shortcutsHelpButton} onClick={() => setShowShortcutsHelp((v) => !v)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts">?</button>
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
            )}
          </div>

          {/* F.R.A.M.E. sidebar footer branding + vault mode toggle */}
          <div className="frame-sidebar-footer" style={{ padding: '6px 16px 8px', borderTop: '1px solid #21262d', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#30363d', fontWeight: 500, letterSpacing: 0.5 }}>F.R.A.M.E. v1.0.0</span>
            <button
              type="button"
              onClick={activateVaultMode}
              title="Activate Vault Mode"
              aria-label="Activate Vault Mode"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 4px',
                fontSize: 12,
                color: '#30363d',
                lineHeight: 1,
                opacity: 0.7,
                transition: 'opacity 0.15s',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                minHeight: 0,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="8" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
                <path d="M5.5 8V5.5a2.5 2.5 0 015 0V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </aside>
      )}

      {/* Main content — always visible, sidebar overlays on mobile */}
      {showMain && (
        <main id="main-content" style={styles.mainContent}>
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

      {/* Device verification gate — blocks new device access */}
      {showDeviceGate && auth && (
        <DeviceVerificationGate
          deviceId={auth.deviceId}
          onVerify={() => {
            // Mark device as verified on server + localStorage, then dismiss gate
            void setDeviceVerified(auth.deviceId);
            try {
              localStorage.setItem(`frame-device-verified:${auth.deviceId}`, 'true');
            } catch { /* localStorage may be unavailable */ }
            setShowDeviceGate(false);
          }}
        />
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
          isGuest={auth.guest === true}
          existingRooms={rooms}
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
          onMemberKicked={() => void handleRetryRoomFetch()}
          showToast={showToast}
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
  // Fluid width is handled by .frame-sidebar CSS class in globalStyles.
  // These are kept as fallbacks / overrides only.

  // ── User info ──
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px 12px',
    borderBottom: '1px solid #21262d',
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: 'transparent',
    border: '2px solid #3fb950',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 700,
    color: '#58a6ff',
    flexShrink: 0,
    boxShadow: '0 0 0 2px #161b22',
  },
  userAvatarInner: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    backgroundColor: '#21262d',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    minWidth: 0,
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e6edf3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: '20px',
  },
  userStatus: {
    fontSize: 12,
    color: '#3fb950',
    fontWeight: 500,
    lineHeight: '16px',
  },
  userDevice: {
    fontSize: 10,
    color: '#3fb950',
    display: 'flex',
    alignItems: 'center',
    marginTop: 1,
    opacity: 0.6,
  },
  totalUnreadBadge: {
    backgroundColor: '#238636',
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
    height: 32,
    background: 'linear-gradient(to bottom, rgba(22, 27, 34, 0), rgba(22, 27, 34, 0.9))',
    pointerEvents: 'none' as const,
    zIndex: 1,
  },

  // ── Sidebar actions ──
  sidebarActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 14px',
    borderTop: '1px solid #21262d',
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
    transition: 'background-color 0.2s ease',
    letterSpacing: '0.02em',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  settingsButton: {
    padding: '8px 10px',
    fontSize: 18,
    backgroundColor: 'transparent',
    color: '#8b949e',
    border: '1px solid #21262d',
    borderRadius: 6,
    cursor: 'pointer',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'border-color 0.2s, background-color 0.2s',
  },
  logoutButton: {
    padding: '8px 10px',
    fontSize: 18,
    backgroundColor: 'transparent',
    color: '#8b949e',
    border: '1px solid #21262d',
    borderRadius: 6,
    cursor: 'pointer',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'border-color 0.2s, background-color 0.2s',
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
    transition: 'background-color 0.2s ease',
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
    padding: '32px 32px 48px',
    overflowY: 'auto',
    gap: 0,
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
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9998,
    animation: 'frame-fade-in 0.15s ease-out',
  },
  leaveModal: {
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 14,
    padding: 24,
    maxWidth: 380,
    width: '90%',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.03)',
    animation: 'frame-modal-enter 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
  },
  leaveCancelBtn: {
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 500,
    backgroundColor: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background-color 0.15s ease',
  },
  leaveConfirmBtn: {
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 600,
    backgroundColor: '#da3633',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background-color 0.15s ease',
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
    borderRadius: 3,
    maxWidth: 380,
    width: '90%',
    borderTop: '2px solid #3fb950',
    boxShadow: '0 0 20px rgba(63,185,80,0.08)',
  },
  lockTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
    color: '#e6edf3',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
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
    borderRadius: 3,
    border: '1px solid #30363d',
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
    marginBottom: 16,
    boxSizing: 'border-box' as const,
    letterSpacing: '0.03em',
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
    fontWeight: 700,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: '1px solid rgba(63,185,80,0.3)',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  lockLogoutButton: {
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: 'transparent',
    color: '#f85149',
    border: '1px solid #6e3630',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  skipToContent: { position: 'absolute' as const, top: -100, left: 8, zIndex: 10001, padding: '8px 16px', backgroundColor: '#58a6ff', color: '#0d1117', fontSize: 13, fontWeight: 600, borderRadius: 3, textDecoration: 'none', transition: 'top 0.2s ease' },
  shortcutsHelpButton: { padding: '6px 10px', fontSize: 13, fontWeight: 700, backgroundColor: 'transparent', color: '#8b949e', border: '1px solid #30363d', borderRadius: 3, cursor: 'pointer', lineHeight: 1, fontFamily: 'inherit', transition: 'border-color 0.15s, color 0.15s' },
  shortcutsPopup: { position: 'absolute' as const, bottom: 44, right: 0, width: 240, padding: 16, backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 100 },
  shortcutsPopupTitle: { fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #21262d' },
  shortcutsPopupRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: 12, color: '#8b949e' },
  kbd: { display: 'inline-block', padding: '2px 6px', fontSize: 11, fontWeight: 600, fontFamily: 'monospace', color: '#c9d1d9', backgroundColor: '#21262d', border: '1px solid #30363d', borderRadius: 4, lineHeight: '16px' },
};

export default App;
