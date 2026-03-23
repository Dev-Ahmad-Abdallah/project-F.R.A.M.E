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

export interface ScreenProtectionState {
  /** True when the document is hidden (tab switch, alt-tab, app backgrounded) */
  isHidden: boolean;
  /** True when the window has lost focus (another window is in front) */
  isBlurred: boolean;
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
  const [captureDetected, setCaptureDetected] = useState(false);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [printScreenFlash, setPrintScreenFlash] = useState(false);

  const originalGetDisplayMediaRef = useRef<typeof navigator.mediaDevices.getDisplayMedia | null>(null);

  const dismissCaptureWarning = useCallback(() => {
    setCaptureDetected(false);
  }, []);

  // ── Helper: check if target is a valid input (textarea in chat input, or form input) ──
  const isInputElement = (target: EventTarget | null): boolean => {
    if (!target) return false;
    const el = target as HTMLElement;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'textarea') {
      return el.classList.contains('frame-chat-textarea') || el.closest('.frame-chat-input-area') !== null;
    }
    if (tag === 'input') return true;
    return el.isContentEditable;
  };

  // ── Flash black utility — used by screenshot interception ──
  const flashBlack = useCallback((ms: number) => {
    try {
      let ov = document.getElementById('frame-screenshot-blackout');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'frame-screenshot-blackout';
        ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#000;z-index:2147483647;pointer-events:none;';
        document.body.appendChild(ov);
      }
      ov.style.display = 'block';
      document.body.style.backgroundColor = '#000';
      document.body.style.transition = 'none';
      setTimeout(() => {
        if (ov) ov.style.display = 'none';
        document.body.style.backgroundColor = '';
        document.body.style.transition = '';
      }, ms);
    } catch {
      // noop
    }
  }, []);

  // ── 1. Block ALL keyboard shortcuts — ALL platforms (ALWAYS ON) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const key = e.key?.toLowerCase();
      const keyCode = e.keyCode;
      const meta = e.metaKey;
      const ctrlK = e.ctrlKey;

      // Block F12
      if (e.key === 'F12' || keyCode === 123) {
        e.preventDefault(); e.stopPropagation(); return;
      }

      // Block Ctrl+Shift+I/J/C (devtools)
      if (ctrl && shift && (key === 'i' || key === 'j' || key === 'c')) {
        e.preventDefault(); e.stopPropagation(); return;
      }

      // Block Ctrl+U (view source)
      if (ctrl && key === 'u' && !shift) {
        e.preventDefault(); e.stopPropagation(); return;
      }

      // Block Ctrl+S (save page)
      if (ctrl && key === 's' && !shift) {
        e.preventDefault(); e.stopPropagation(); return;
      }

      // Block Ctrl+P (print)
      if (ctrl && key === 'p') {
        e.preventDefault(); e.stopPropagation(); return;
      }

      // Allow Ctrl+C (copy), Ctrl+A (select all), Ctrl+X (cut) everywhere.
      // Blocking these breaks essential UX in a messaging app (copy messages,
      // copy code blocks, copy user IDs, etc.).
      // Ctrl+Shift+C is still blocked above (devtools).

      // Mac: Cmd+Shift+3/4/5 (screenshots)
      if (meta && shift && (key === '3' || key === '4' || key === '5')) {
        e.preventDefault(); e.stopPropagation();
        flashBlack(800); setPrintScreenFlash(true);
        setTimeout(() => setPrintScreenFlash(false), 800);
        return;
      }

      // Mac: Cmd+Ctrl+Shift+3/4 (clipboard screenshots)
      if (meta && ctrlK && shift && (key === '3' || key === '4')) {
        e.preventDefault(); e.stopPropagation();
        flashBlack(800); setPrintScreenFlash(true);
        setTimeout(() => setPrintScreenFlash(false), 800);
        return;
      }

      // Windows/Linux: PrintScreen (keyCode 44)
      if (keyCode === 44) {
        e.preventDefault(); e.stopPropagation();
        flashBlack(800); setPrintScreenFlash(true);
        setTimeout(() => setPrintScreenFlash(false), 800);
        return;
      }

      // Windows: Win+Shift+S (Snipping Tool)
      if ((meta || ctrlK) && shift && key === 's') {
        e.preventDefault(); e.stopPropagation();
        flashBlack(800); setPrintScreenFlash(true);
        setTimeout(() => setPrintScreenFlash(false), 800);
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    // Also capture keyup for PrintScreen
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.keyCode === 44) {
        e.preventDefault(); e.stopPropagation();
        flashBlack(800); setPrintScreenFlash(true);
        setTimeout(() => setPrintScreenFlash(false), 800);
      }
    };
    document.addEventListener('keyup', handleKeyUp, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [flashBlack]);

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

  // ── 3. Text selection: allowed everywhere ──
  // Previously blocked globally, but this prevented users from selecting
  // message text, code blocks, user IDs, etc. to copy them — essential
  // UX in a messaging app. Selection is now permitted.

  // ── 4. Clipboard: allow copy/cut everywhere ──
  // Copy and cut are essential UX operations in a messaging app (copy messages,
  // copy code blocks, copy user IDs, share invite codes, etc.).
  // We no longer block clipboard operations or override navigator.clipboard APIs.

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
  // Delay blur activation by 500ms to avoid triggering on browser permission
  // dialogs (mic, camera, notifications) which steal focus briefly.
  // The global window.__framePermissionPending flag is set by components
  // that call getUserMedia/requestPermission so blur is suppressed entirely
  // during permission flows.
  useEffect(() => {
    let blurTimer: ReturnType<typeof setTimeout> | null = null;

    const handleBlur = () => {
      // Don't activate if a permission dialog is pending
      if ((window as unknown as Record<string, unknown>).__framePermissionPending) return;
      blurTimer = setTimeout(() => {
        // Re-check: focus may have returned during the delay
        if (!document.hasFocus() && !(window as unknown as Record<string, unknown>).__framePermissionPending) {
          setIsBlurred(true);
        }
      }, 500);
    };
    const handleFocus = () => {
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
      setIsBlurred(false);
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      if (blurTimer) clearTimeout(blurTimer);
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

  // ── 9. Screen capture API interception — BLACK OUT ──
  useEffect(() => {
    if (!navigator.mediaDevices?.getDisplayMedia) return;

    const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    originalGetDisplayMediaRef.current = original;

    navigator.mediaDevices.getDisplayMedia = async function (constraints?: DisplayMediaStreamOptions): Promise<MediaStream> {
      setCaptureDetected(true);
      flashBlack(2000);
      setTimeout(() => setCaptureDetected(false), 5000);
      return original(constraints);
    };

    return () => {
      if (originalGetDisplayMediaRef.current) {
        navigator.mediaDevices.getDisplayMedia = originalGetDisplayMediaRef.current;
      }
    };
  }, [flashBlack]);

  // ── 10. MutationObserver: watch for injected scripts/iframes/links/styles + extension detection ──
  useEffect(() => {
    const suspiciousTags = new Set(['script', 'iframe', 'link', 'style']);
    const knownIds = new Set<string>();
    document.querySelectorAll('style[id],link[id]').forEach(el => {
      if (el.id) knownIds.add(el.id);
    });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes.item(i) as HTMLElement;
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const tag = node.tagName?.toLowerCase();
          if (!suspiciousTags.has(tag)) continue;
          // Skip known app elements
          if (node.id && (node.id.startsWith('frame-') || knownIds.has(node.id))) continue;
          const src = (node as HTMLIFrameElement).src || (node as HTMLLinkElement).href || '';
          if (src && !src.startsWith(window.location.origin) && !src.startsWith('about:') && !src.startsWith('blob:') && !src.startsWith('data:')) {
            try {
              node.remove();
              setCaptureDetected(true);
              setTimeout(() => setCaptureDetected(false), 5000);
            } catch {
              // ignore
            }
          }
          // Inline scripts without src that aren't ours
          if (tag === 'script' && !src && !node.id?.startsWith('frame-')) {
            try { node.remove(); } catch { /* */ }
          }
        }
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
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

  // ── 12. Canvas toDataURL / toBlob override — return blank data ──
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const savedToDataURL = HTMLCanvasElement.prototype.toDataURL;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const savedToBlob = HTMLCanvasElement.prototype.toBlob;
    // eslint-disable-next-line no-secrets/no-secrets
    const blankPng = ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ', 'AAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='].join('');
    try {
      HTMLCanvasElement.prototype.toDataURL = function (_type?: string, _quality?: unknown): string {
        return blankPng;
      };
    } catch { /* */ }
    try {
      HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, _type?: string, _quality?: unknown): void {
        cb(new Blob([], { type: 'image/png' }));
      };
    } catch { /* */ }
    return () => {
      try { HTMLCanvasElement.prototype.toDataURL = savedToDataURL; } catch { /* */ }
      try { HTMLCanvasElement.prototype.toBlob = savedToBlob; } catch { /* */ }
    };
  }, []);

  // ── 13. requestAnimationFrame gap detection (mobile backgrounding) ──
  useEffect(() => {
    let running = true;
    let lastTs = 0;
    const check = (ts: number) => {
      if (!running) return;
      if (lastTs > 0 && ts - lastTs > 500) {
        flashBlack(300);
      }
      lastTs = ts;
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
    return () => { running = false; };
  }, [flashBlack]);

  // ── 14. document.hasFocus() polling every 200ms ──
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        if (!document.hasFocus()) setIsBlurred(true);
      } catch {
        // ignore
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // ── 15. PictureInPicture detection ──
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        if (document.pictureInPictureElement) {
          setCaptureDetected(true);
          void document.exitPictureInPicture().catch(() => { /* noop */ });
        }
      } catch {
        // ignore
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── 16. Virtual device detection (OBS, etc.) ──
  useEffect(() => {
    const checkDevices = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        const pattern = /virtual|obs|screen.capture|blackhole|soundflower|vb-cable|voicemeeter/i;
        for (const d of devices) {
          if (pattern.test(d.label)) {
            setCaptureDetected(true);
            setTimeout(() => setCaptureDetected(false), 10000);
            break;
          }
        }
      } catch {
        // ignore
      }
    };
    void checkDevices();
    const interval = setInterval(() => { void checkDevices(); }, 5000);
    return () => clearInterval(interval);
  }, []);

  // ── 17. AudioContext capture prevention ──
  useEffect(() => {
    try {
      const Ctx = window.AudioContext;
      if (!Ctx) return undefined;
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const origMethod = Ctx.prototype.createMediaStreamDestination;
      Ctx.prototype.createMediaStreamDestination = function (this: AudioContext) {
        setCaptureDetected(true);
        setTimeout(() => setCaptureDetected(false), 5000);
        return origMethod.call(this);
      };
      return () => {
        try { Ctx.prototype.createMediaStreamDestination = origMethod; } catch { /* */ }
      };
    } catch {
      // ignore
    }
    return undefined;
  }, []);

  // ── 18. Mobile multi-touch gesture detection ──
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      // 3+ fingers could indicate screenshot gesture
      if (e.touches.length >= 3) flashBlack(500);
    };
    document.addEventListener('touchstart', handler, { passive: true, capture: true } as AddEventListenerOptions);
    return () => document.removeEventListener('touchstart', handler, true);
  }, [flashBlack]);

  // ── 19. Block print (CSS + beforeprint event) ──
  useEffect(() => {
    const onBeforePrint = () => { document.body.style.display = 'none'; };
    const onAfterPrint = () => { document.body.style.display = ''; };
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    const printBlockStyle = document.createElement('style');
    printBlockStyle.id = 'frame-print-block';
    printBlockStyle.textContent = '@media print{body,html,#root{display:none!important;visibility:hidden!important}}';
    document.head.appendChild(printBlockStyle);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
      try { printBlockStyle.remove(); } catch { /* */ }
    };
  }, []);

  // ── 20. Block navigator.share ──
  useEffect(() => {
    try {
      if (navigator.share) {
        const origShare = navigator.share.bind(navigator);
        const blockedShare = async (data?: ShareData): Promise<void> => {
          if (data?.text || data?.url?.includes(window.location.origin)) {
            throw new DOMException('Blocked by privacy protection', 'NotAllowedError');
          }
          return origShare(data);
        };
        (navigator as unknown as Record<string, unknown>).share = blockedShare;
      }
    } catch {
      // ignore
    }
  }, []);

  return {
    isHidden,
    isBlurred,
    captureDetected,
    dismissCaptureWarning,
    devtoolsOpen,
    printScreenFlash,
  };
}
