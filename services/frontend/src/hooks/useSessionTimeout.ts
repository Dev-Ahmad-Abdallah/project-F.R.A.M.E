/**
 * useSessionTimeout — Tracks user activity and triggers logout/lock on inactivity.
 *
 * Listens for mouse, keyboard, and touch events. When the user has been
 * inactive for the configured timeout, calls the onTimeout callback.
 * Shows a warning 60 seconds before timeout via the `isWarning` flag.
 *
 * The timeout duration is read from localStorage so the SessionSettings
 * panel can update it without a page reload.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ── localStorage key ──

const TIMEOUT_KEY = 'frame:session-timeout-ms';
const AUTOLOCK_KEY = 'frame:session-autolock';

// ── Preset values (in milliseconds) ──

export const SESSION_TIMEOUT_OPTIONS = [
  { label: '5 minutes', value: 5 * 60 * 1000 },
  { label: '10 minutes', value: 10 * 60 * 1000 },
  { label: '30 minutes', value: 30 * 60 * 1000 },
  { label: '1 hour', value: 60 * 60 * 1000 },
  { label: '4 hours', value: 4 * 60 * 60 * 1000 },
  { label: 'Never', value: 0 },
] as const;

const WARNING_THRESHOLD_MS = 60 * 1000; // 1 minute before timeout

// ── Helpers ──

export function getSavedTimeout(): number {
  try {
    const raw = localStorage.getItem(TIMEOUT_KEY);
    if (raw !== null) return Number(raw);
  } catch { /* ignore */ }
  return 30 * 60 * 1000; // default 30 min
}

export function setSavedTimeout(ms: number): void {
  try {
    localStorage.setItem(TIMEOUT_KEY, String(ms));
  } catch { /* ignore */ }
}

export function getAutoLock(): boolean {
  try {
    return localStorage.getItem(AUTOLOCK_KEY) === 'true';
  } catch { /* ignore */ }
  return false;
}

export function setAutoLock(enabled: boolean): void {
  try {
    localStorage.setItem(AUTOLOCK_KEY, String(enabled));
  } catch { /* ignore */ }
}

// ── Hook ──

interface UseSessionTimeoutResult {
  /** Milliseconds until timeout (0 if already timed out, Infinity if "Never") */
  timeRemaining: number;
  /** True when the user will time out within 60 seconds */
  isWarning: boolean;
  /** Call this to reset the timer (e.g. user clicks "Stay active") */
  resetTimer: () => void;
}

export function useSessionTimeout(
  onTimeout: () => void,
): UseSessionTimeoutResult {
  const [timeRemaining, setTimeRemaining] = useState<number>(Infinity);
  const [isWarning, setIsWarning] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const hasFiredRef = useRef(false);
  const isWarningRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    hasFiredRef.current = false;
    isWarningRef.current = false;
    setIsWarning(false);
  }, []);

  // Listen for user activity events
  useEffect(() => {
    const handleActivity = () => {
      // Bug 6 fix: Once the warning period starts, do NOT reset the timer
      // on passive activity. The user must explicitly click "Stay active"
      // (which calls resetTimer) to extend the session.
      if (isWarningRef.current || hasFiredRef.current) return;
      lastActivityRef.current = Date.now();
    };

    const events = ['mousemove', 'mousedown', 'click', 'keydown', 'touchstart', 'scroll', 'pointerdown'];
    for (const evt of events) {
      window.addEventListener(evt, handleActivity, { passive: true });
    }

    // Also reset on tab becoming visible (user returning to the app)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleActivity();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      for (const evt of events) {
        window.removeEventListener(evt, handleActivity);
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Tick every second to update remaining time
  useEffect(() => {
    const interval = setInterval(() => {
      if (hasFiredRef.current) return;

      const timeoutMs = getSavedTimeout();
      const autoLock = getAutoLock();

      // "Never" or auto-lock disabled
      if (timeoutMs === 0 || !autoLock) {
        // Bug 5 fix: Only update state if the value actually changed
        setTimeRemaining((prev) => (prev === Infinity ? prev : Infinity));
        if (isWarningRef.current) {
          isWarningRef.current = false;
          setIsWarning(false);
        }
        return;
      }

      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, timeoutMs - elapsed);
      const nowWarning = remaining > 0 && remaining <= WARNING_THRESHOLD_MS;

      // Bug 5 fix: Only update state when the value has meaningfully changed
      // (within a 1-second tolerance to avoid unnecessary re-renders)
      setTimeRemaining((prev) => {
        if (prev === remaining) return prev;
        // Only re-render if the difference is >= 500ms (visible change)
        if (Math.abs(prev - remaining) < 500 && prev !== Infinity) return prev;
        return remaining;
      });

      if (nowWarning !== isWarningRef.current) {
        isWarningRef.current = nowWarning;
        setIsWarning(nowWarning);
      }

      // Bug 6 fix: When remaining reaches 0, forcefully trigger timeout.
      // The timer cannot be reset by passive activity during the warning period.
      if (remaining === 0) {
        hasFiredRef.current = true;
        onTimeoutRef.current();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return { timeRemaining, isWarning, resetTimer };
}
