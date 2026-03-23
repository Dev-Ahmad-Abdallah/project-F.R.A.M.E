/**
 * PrivacyShield — Screen capture protection overlays for F.R.A.M.E.
 *
 * Renders invisible protection layers:
 *   1. Black overlay — instantly covers screen when app loses visibility (tab switch, background)
 *   2. Black overlay — covers screen when window loses focus (desktop screenshot tools)
 *   3. Capture warning toast — shown when screen recording is detected
 */

import React, { useEffect, useState } from 'react';
import { markPrivacyModeUsed } from '../utils/rankSystem';

interface PrivacyShieldProps {
  /** Whether the document is hidden (visibility change) */
  isHidden: boolean;
  /** Whether the window has lost focus */
  isBlurred: boolean;
  /** Whether a screen capture attempt was detected */
  captureDetected: boolean;
  /** Dismiss capture warning */
  onDismissCaptureWarning: () => void;
}

const PrivacyShield: React.FC<PrivacyShieldProps> = ({
  isHidden,
  isBlurred,
  captureDetected,
  onDismissCaptureWarning,
}) => {
  // Fade-in animation for returning from hidden state
  const [fadeIn, setFadeIn] = useState(false);
  const [wasHidden, setWasHidden] = useState(false);

  // Mark privacy mode as used when shield activates
  useEffect(() => {
    if (isHidden || isBlurred) {
      markPrivacyModeUsed();
    }
  }, [isHidden, isBlurred]);

  useEffect(() => {
    if (isHidden) {
      setWasHidden(true);
    } else if (wasHidden) {
      setFadeIn(true);
      setWasHidden(false);
      const timer = setTimeout(() => setFadeIn(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isHidden, wasHidden]);

  // Toast removed — capture detection toast was annoying and unnecessary.
  // Auto-dismiss the captureDetected flag silently without showing anything.
  useEffect(() => {
    if (captureDetected) {
      onDismissCaptureWarning();
    }
  }, [captureDetected, onDismissCaptureWarning]);

  return (
    <>
      {/* 1. Black screen overlay — instant, above everything */}
      {isHidden && (
        <div
          style={overlayStyles.blackOverlay}
          aria-hidden="true"
          data-testid="privacy-black-overlay"
        />
      )}

      {/* 2. FULL BLACK overlay — when window loses focus */}
      {isBlurred && !isHidden && (
        <div
          style={overlayStyles.blurOverlay}
          aria-hidden="true"
          data-testid="privacy-blur-overlay"
        />
      )}

      {/* Fade-in mask when returning from hidden */}
      {fadeIn && (
        <div
          style={overlayStyles.fadeInMask}
          aria-hidden="true"
        />
      )}

      {/* Screen capture warning toast removed — unnecessary and annoying */}
    </>
  );
};

// ── Inline styles ──

const overlayStyles: Record<string, React.CSSProperties> = {
  // Black overlay: instant, no transition, covers everything
  blackOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    zIndex: 999999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // No transition — must be instant
  },
  // FULL BLACK overlay on blur — not just blur, complete blackout
  blurOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    zIndex: 999998,
    // No transition — must be instant
  },

  // Fade-in mask when returning from hidden
  fadeInMask: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    zIndex: 999997,
    pointerEvents: 'none',
    animation: 'frame-privacy-fade-in 0.3s ease-out forwards',
  },

  // Screen capture warning toast
  captureToast: {
    position: 'fixed',
    top: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 999999,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 18px',
    backgroundColor: 'rgba(248, 81, 73, 0.15)',
    border: '1px solid rgba(248, 81, 73, 0.4)',
    borderRadius: 10,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    maxWidth: '90vw',
  },
  captureToastText: {
    color: '#f85149',
    fontSize: 13,
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  captureToastDismiss: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#8b949e',
    fontSize: 16,
    cursor: 'pointer',
    padding: '4px 8px',
    lineHeight: 1,
    fontFamily: 'inherit',
    flexShrink: 0,
  },
};

export default PrivacyShield;
