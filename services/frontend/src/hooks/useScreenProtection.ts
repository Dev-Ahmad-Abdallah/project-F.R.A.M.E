/**
 * useScreenProtection — Aggressive screen capture / screenshot / devtools protection.
 *
 * ALL protections are ALWAYS ON. Privacy mode toggle only controls the watermark.
 *
 * Protections:
 *   - Blocks all devtools keyboard shortcuts (F12, Ctrl+Shift+I/J/C, Cmd+Option+I)
 *   - Blocks Ctrl+U (view source), Ctrl+S (save), Ctrl+P (print)
 *   - Blocks Ctrl+C, Ctrl+A, Ctrl+X globally (except in input/textarea)
 *   - Blocks right-click context menu everywhere
 *   - Blocks text selection (selectstart) everywhere
 *   - Blocks drag and drop of all content
 *   - Detects devtools open via window size heuristic (1s interval)
 *   - Intercepts PrintScreen key — flashes screen black for 500ms
 *   - Visibility change → instant black screen
 *   - Window blur → heavy blur overlay
 *   - MutationObserver watching for injected elements
 *   - Screen capture API interception
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const PRIVACY_MODE_KEY = 'frame-privacy-mode';

export interface ScreenProtectionState {
  /** True when the document is hidden (tab switch, alt-tab, app backgrounded) */
  isHidden: boolean;
  /** True when the window has lost focus (another window is in front) */
  isBlurred: boolean;
  /** True when privacy mode (watermark) is enabled */
  privacyMode: boolean;
  /** Toggle privacy mode on/off (only controls watermark) */
  setPrivacyMode: (enabled: boolean) => void;
  /** True when a screen capture attempt has been detected */
  captureDetected: boolean;
  /** Dismiss the capture detection warning */
  dismissCaptureWarning: () => void;
  /** True when devtools is detected as open */
  devtoolsOpen: boolean;
  /** True when PrintScreen flash is active */
  printScreenFlash: boolean;
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
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [printScreenFlash, setPrintScreenFlash] = useState(false);

  const originalGetDisplayMediaRef = useRef<typeof navigator.mediaDevices.getDisplayMedia | null>(null);

  const setPrivacyMode = useCallback((enabled: boolean) => {
    setPrivacyModeState(enabled);
    try {
      localStorage.setItem(PRIVACY_MODE_KEY, String(enabled));
    } catch {
      // localStorage may be unavailable
    }
  }, []);

  const dismissCaptureWarning = useCallback(() => {
    setCaptureDetected(false);
  }, []);

  // ── Helper: check if target is an input/textarea ──
  const isInputElement = (target: EventTarget | null): boolean => {
    if (!target) return false;
    const el = target as HTMLElement;
    const tag = el.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable;
  };

  // ── 1. Block ALL keyboard shortcuts (ALWAYS ON) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const key = e.key?.toLowerCase();
      const keyCode = e.keyCode;

      // Block F12
      if (e.key === 'F12' || keyCode === 123) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Block Ctrl+Shift+I (devtools), Ctrl+Shift+J (console), Ctrl+Shift+C (inspector)
      if (ctrl && shift && (key === 'i' || key === 'j' || key === 'c')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Block Ctrl+U (view source)
      if (ctrl && key === 'u' && !shift) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Block Ctrl+S (save page)
      if (ctrl && key === 's' && !shift) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Block Ctrl+P (print)
      if (ctrl && key === 'p') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Block Ctrl+C, Ctrl+A, Ctrl+X GLOBALLY (except in input/textarea)
      if (ctrl && (key === 'c' || key === 'a' || key === 'x') && !isInputElement(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Intercept PrintScreen (keyCode 44)
      if (keyCode === 44) {
        e.preventDefault();
        e.stopPropagation();
        // Flash screen black for 500ms
        setPrintScreenFlash(true);
        setTimeout(() => setPrintScreenFlash(false), 500);
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    // Also capture keyup for PrintScreen (some browsers fire it on keyup)
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.keyCode === 44) {
        e.preventDefault();
        e.stopPropagation();
        setPrintScreenFlash(true);
        setTimeout(() => setPrintScreenFlash(false), 500);
      }
    };
    document.addEventListener('keyup', handleKeyUp, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keyup', handleKeyUp, true);
    };
  }, []);

  // ── 2. Block right-click context menu EVERYWHERE ──
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    document.addEventListener('contextmenu', handleContextMenu, true);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, []);

  // ── 3. Block text selection (selectstart) EVERYWHERE ──
  useEffect(() => {
    const handleSelectStart = (e: Event) => {
      if (isInputElement(e.target)) return; // allow selection in inputs
      e.preventDefault();
    };

    document.addEventListener('selectstart', handleSelectStart, true);
    return () => {
      document.removeEventListener('selectstart', handleSelectStart, true);
    };
  }, []);

  // ── 4. Block copy event EVERYWHERE (except inputs) ──
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (isInputElement(e.target)) return;
      e.preventDefault();
    };

    document.addEventListener('copy', handleCopy, true);
    return () => {
      document.removeEventListener('copy', handleCopy, true);
    };
  }, []);

  // ── 5. Block drag and drop of all content ──
  useEffect(() => {
    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
    };

    document.addEventListener('dragstart', handleDragStart, true);
    document.addEventListener('drop', handleDrop, true);
    return () => {
      document.removeEventListener('dragstart', handleDragStart, true);
      document.removeEventListener('drop', handleDrop, true);
    };
  }, []);

  // ── 6. Visibility change (tab switch, app background) — instant black ──
  useEffect(() => {
    const handleVisibilityChange = () => {
      const hidden = document.visibilityState === 'hidden';
      setIsHidden(hidden);
      if (hidden) {
        // Immediately set body to black as a fallback
        document.body.style.backgroundColor = '#000';
        document.body.style.transition = 'none';
      } else {
        // Restore after 50ms
        setTimeout(() => {
          document.body.style.backgroundColor = '';
          document.body.style.transition = '';
        }, 50);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // ── 7. Window blur/focus ──
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

  // ── 8. DevTools detection via window size heuristic (1s interval) ──
  useEffect(() => {
    const checkDevtools = () => {
      const widthThreshold = window.outerWidth - window.innerWidth > 160;
      const heightThreshold = window.outerHeight - window.innerHeight > 160;
      setDevtoolsOpen(widthThreshold || heightThreshold);
    };

    // Check immediately
    checkDevtools();

    const interval = setInterval(checkDevtools, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── 9. Screen capture API interception ──
  useEffect(() => {
    if (!navigator.mediaDevices?.getDisplayMedia) return;

    const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    originalGetDisplayMediaRef.current = original;

    navigator.mediaDevices.getDisplayMedia = async function (...args: Parameters<typeof navigator.mediaDevices.getDisplayMedia>) {
      setCaptureDetected(true);
      setTimeout(() => setCaptureDetected(false), 5000);
      return original(...args);
    };

    return () => {
      if (originalGetDisplayMediaRef.current) {
        navigator.mediaDevices.getDisplayMedia = originalGetDisplayMediaRef.current;
      }
    };
  }, []);

  // ── 10. MutationObserver: watch for injected suspicious elements ──
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i] as HTMLElement;
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Detect suspicious injected iframes or scripts (extension overlays)
            const tag = node.tagName?.toLowerCase();
            if (tag === 'iframe' || tag === 'script') {
              const src = (node as HTMLIFrameElement).src || '';
              // Allow same-origin and known safe sources
              if (src && !src.startsWith(window.location.origin) && !src.startsWith('about:') && !src.startsWith('blob:')) {
                node.remove();
              }
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // ── 11. Prevent image context menu and dragging via global handler ──
  useEffect(() => {
    const preventImageActions = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName?.toLowerCase() === 'img') {
        e.preventDefault();
      }
    };

    document.addEventListener('mousedown', preventImageActions, true);
    return () => {
      document.removeEventListener('mousedown', preventImageActions, true);
    };
  }, []);

  return {
    isHidden,
    isBlurred,
    privacyMode,
    setPrivacyMode,
    captureDetected,
    dismissCaptureWarning,
    devtoolsOpen,
    printScreenFlash,
  };
}
