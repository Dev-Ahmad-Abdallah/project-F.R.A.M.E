/**
 * useScreenProtection — Custom hook for screen capture / screenshot protection.
 *
 * Detects visibility changes, focus loss, and screen capture attempts.
 * Returns state flags and a toggle for "privacy mode" (watermark + all protections).
 *
 * Persists the privacy mode preference in localStorage.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const PRIVACY_MODE_KEY = 'frame-privacy-mode';

export interface ScreenProtectionState {
  /** True when the document is hidden (tab switch, alt-tab, app backgrounded) */
  isHidden: boolean;
  /** True when the window has lost focus (another window is in front) */
  isBlurred: boolean;
  /** True when privacy mode (watermark + protections) is enabled */
  privacyMode: boolean;
  /** Toggle privacy mode on/off */
  setPrivacyMode: (enabled: boolean) => void;
  /** True when a screen capture attempt has been detected */
  captureDetected: boolean;
  /** Dismiss the capture detection warning */
  dismissCaptureWarning: () => void;
}

export function useScreenProtection(): ScreenProtectionState {
  const [isHidden, setIsHidden] = useState(false);
  const [isBlurred, setIsBlurred] = useState(false);
  const [privacyMode, setPrivacyModeState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PRIVACY_MODE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [captureDetected, setCaptureDetected] = useState(false);

  // Keep a ref to the original getDisplayMedia so we can detect calls
  const originalGetDisplayMediaRef = useRef<typeof navigator.mediaDevices.getDisplayMedia | null>(null);

  const setPrivacyMode = useCallback((enabled: boolean) => {
    setPrivacyModeState(enabled);
    try {
      localStorage.setItem(PRIVACY_MODE_KEY, String(enabled));
    } catch {
      // localStorage may be unavailable in private browsing
    }
  }, []);

  const dismissCaptureWarning = useCallback(() => {
    setCaptureDetected(false);
  }, []);

  // ── Visibility change (tab switch, app background) ──
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsHidden(document.visibilityState === 'hidden');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // ── Window focus / blur ──
  useEffect(() => {
    const handleBlur = () => setIsBlurred(true);
    const handleFocus = () => setIsBlurred(false);

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // ── Prevent copy (Ctrl+C / Cmd+C) on message content ──
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('.frame-message-content') || target?.closest?.('.frame-msg-bubble')) {
        e.preventDefault();
      }
    };

    document.addEventListener('copy', handleCopy, true);
    return () => {
      document.removeEventListener('copy', handleCopy, true);
    };
  }, []);

  // ── Prevent right-click context menu on message area ──
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('.frame-message-content') || target?.closest?.('.frame-msg-bubble') || target?.closest?.('.frame-chat-messages')) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu, true);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, []);

  // ── Screen capture API detection ──
  useEffect(() => {
    if (!navigator.mediaDevices?.getDisplayMedia) return;

    // Store the original reference
    const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    originalGetDisplayMediaRef.current = original;

    // Wrap getDisplayMedia to detect screen capture attempts
    navigator.mediaDevices.getDisplayMedia = async function (...args: Parameters<typeof navigator.mediaDevices.getDisplayMedia>) {
      setCaptureDetected(true);
      // Auto-dismiss after 5 seconds
      setTimeout(() => setCaptureDetected(false), 5000);
      return original(...args);
    };

    return () => {
      // Restore original
      if (originalGetDisplayMediaRef.current) {
        navigator.mediaDevices.getDisplayMedia = originalGetDisplayMediaRef.current;
      }
    };
  }, []);

  // ── Prevent keyboard shortcuts for copy on message content ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isMessageArea = target?.closest?.('.frame-message-content') || target?.closest?.('.frame-msg-bubble') || target?.closest?.('.frame-chat-messages');

      if (isMessageArea && (e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  return {
    isHidden,
    isBlurred,
    privacyMode,
    setPrivacyMode,
    captureDetected,
    dismissCaptureWarning,
  };
}
