/**
 * useNotifications — React hook for managing notification state in F.R.A.M.E.
 *
 * Provides:
 *   - `requestPermission()` — prompts the user for notification permission
 *   - `isEnabled` — whether notifications are currently permitted
 *   - `unreadCount` — total unread messages across all rooms
 *   - `unreadByRoom` — per-room unread counts
 *   - `incrementUnread(roomId)` — bump unread for a room (call on new sync events)
 *   - `clearUnread(roomId)` — reset unread for a room (call when room is opened)
 *   - `notifyIfHidden()` — show a browser notification when the tab is in the background
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  requestNotificationPermission,
  isNotificationPermissionGranted,
  sendLocalNotification,
} from '../notifications';

interface UseNotificationsReturn {
  /** Whether browser notifications are currently granted. */
  isEnabled: boolean;
  /** Prompt the user for notification permission. */
  requestPermission: () => Promise<void>;
  /** Total unread count across all rooms. */
  unreadCount: number;
  /** Per-room unread counts. */
  unreadByRoom: Record<string, number>;
  /** Increment unread counter for a specific room. */
  incrementUnread: (roomId: string, count?: number) => void;
  /** Reset unread counter for a specific room (when it is opened). */
  clearUnread: (roomId: string) => void;
  /**
   * Show a browser notification if the document is hidden (background tab).
   * Does nothing when the tab is in the foreground.
   */
  notifyIfHidden: () => void;
  /** Initialise unread counts from server data (e.g. room list fetch). */
  setInitialUnread: (counts: Record<string, number>) => void;
}

export function useNotifications(): UseNotificationsReturn {
  const [isEnabled, setIsEnabled] = useState<boolean>(
    isNotificationPermissionGranted(),
  );

  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>({});

  // Keep a ref so notifyIfHidden always reads latest unread state without
  // needing to be in the dependency array of callers.
  const unreadRef = useRef(unreadByRoom);
  useEffect(() => {
    unreadRef.current = unreadByRoom;
  }, [unreadByRoom]);

  // Derived total
  const unreadCount = useMemo(
    () => Object.values(unreadByRoom).reduce((sum, n) => sum + n, 0),
    [unreadByRoom],
  );

  // ── Permission ──

  const requestPermission = useCallback(async () => {
    const result = await requestNotificationPermission();
    setIsEnabled(result === 'granted');
  }, []);

  // Re-check permission when the window regains focus (user may have
  // toggled it in browser settings).
  useEffect(() => {
    const handleFocus = () => {
      setIsEnabled(isNotificationPermissionGranted());
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // ── Unread tracking ──

  const incrementUnread = useCallback((roomId: string, count: number = 1) => {
    setUnreadByRoom((prev) => ({
      ...prev,
      [roomId]: (prev[roomId] || 0) + count,
    }));
  }, []);

  const clearUnread = useCallback((roomId: string) => {
    setUnreadByRoom((prev) => {
      if (!prev[roomId]) return prev; // no-op avoids re-render
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
  }, []);

  const setInitialUnread = useCallback((counts: Record<string, number>) => {
    setUnreadByRoom(counts);
  }, []);

  // ── Background notification ──

  const notifyIfHidden = useCallback(() => {
    if (document.visibilityState === 'hidden' && isNotificationPermissionGranted()) {
      sendLocalNotification('F.R.A.M.E.', 'New message');
    }
  }, []);

  // ── Document title ──

  useEffect(() => {
    const baseTitle = 'F.R.A.M.E.';
    if (unreadCount > 0) {
      document.title = `${baseTitle} (${unreadCount})`;
    } else {
      document.title = baseTitle;
    }
  }, [unreadCount]);

  return {
    isEnabled,
    requestPermission,
    unreadCount,
    unreadByRoom,
    incrementUnread,
    clearUnread,
    notifyIfHidden,
    setInitialUnread,
  };
}

export default useNotifications;
