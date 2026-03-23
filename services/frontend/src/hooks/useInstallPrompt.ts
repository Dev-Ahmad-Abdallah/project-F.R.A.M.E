/**
 * useInstallPrompt — Hook for PWA install prompt management.
 *
 * Captures the `beforeinstallprompt` event so the app can show
 * a custom "Install F.R.A.M.E." banner. Tracks dismissal in
 * localStorage so the banner doesn't reappear after the user
 * clicks "Not now".
 *
 * On iOS (Safari), `beforeinstallprompt` is never fired. Instead,
 * we detect iOS via userAgent and show manual instructions:
 * "Tap Share → Add to Home Screen".
 */

import { useState, useEffect, useCallback } from 'react';

const DISMISS_KEY = 'frame-install-dismissed';
const VISIT_KEY = 'frame-visit-count';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function detectIsIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Explicit iPhone/iPad/iPod check
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPad OS 13+ identifies as MacIntel with touch — but exclude desktop Macs
  // by also checking that the screen is portrait-capable (max dimension ≤ 1366)
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
    return Math.min(window.screen.width, window.screen.height) <= 1024;
  }
  return false;
}

function detectIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // Check display-mode media query (works on Android + iOS)
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS-specific check
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
  return false;
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [installed, setInstalled] = useState(false);
  const [isIOS] = useState(detectIsIOS);
  const [isStandalone] = useState(detectIsStandalone);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const appInstalledHandler = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', appInstalledHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', appInstalledHandler);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstalled(true);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const dismissBanner = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // localStorage may be unavailable
    }
  }, []);

  // Don't show on first visit — let users explore the landing page first.
  // Show from the 2nd visit onward.
  const [hasEnoughVisits] = useState(() => {
    try {
      const count = parseInt(localStorage.getItem(VISIT_KEY) || '0', 10);
      localStorage.setItem(VISIT_KEY, String(count + 1));
      return count >= 1;
    } catch {
      return false;
    }
  });

  // Show banner for Android (has deferred prompt) OR iOS (no prompt, but not yet installed)
  const showBanner =
    (!dismissed && !installed && !isStandalone && hasEnoughVisits) &&
    (!!deferredPrompt || (isIOS));

  return { showBanner, promptInstall, dismissBanner, isIOS };
}
