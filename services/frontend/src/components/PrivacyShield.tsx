/**
 * PrivacyShield — Screen capture protection overlays for F.R.A.M.E.
 *
 * Renders three layers:
 *   1. Black overlay — instantly covers screen when app loses visibility (tab switch, background)
 *   2. Blur overlay — blurs app when window loses focus (desktop screenshot tools)
 *   3. Watermark overlay — subtle diagonal repeating user ID text when privacy mode is on
 *   4. Capture warning toast — shown when screen recording is detected
 */

import React, { useEffect, useState } from 'react';

interface PrivacyShieldProps {
  /** Whether the document is hidden (visibility change) */
  isHidden: boolean;
  /** Whether the window has lost focus */
  isBlurred: boolean;
  /** Whether privacy mode is enabled (shows watermark) */
  privacyMode: boolean;
  /** User identifier for watermark text */
  userId?: string;
  /** Whether a screen capture attempt was detected */
  captureDetected: boolean;
  /** Dismiss capture warning */
  onDismissCaptureWarning: () => void;
}

const PrivacyShield: React.FC<PrivacyShieldProps> = ({
  isHidden,
  isBlurred,
  privacyMode,
  userId,
  captureDetected,
  onDismissCaptureWarning,
}) => {
  // Fade-in animation for returning from hidden state
  const [fadeIn, setFadeIn] = useState(false);
  const [wasHidden, setWasHidden] = useState(false);

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

  // Toast auto-dismiss
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (captureDetected) {
      setShowToast(true);
      const timer = setTimeout(() => {
        setShowToast(false);
        onDismissCaptureWarning();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [captureDetected, onDismissCaptureWarning]);

  // Extract short username (strip @user:server format)
  const shortLabel = userId
    ? userId.replace(/^@/, '').replace(/:.*$/, '')
    : 'PROTECTED';

  return (
    <>
      {/* 1. Black screen overlay — instant, above everything */}
      {isHidden && (
        <div
          style={overlayStyles.blackOverlay}
          aria-hidden="true"
          data-testid="privacy-black-overlay"
        >
          <div style={overlayStyles.blackOverlayContent}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.3 }}>
              <path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-2h2v2h-2zm0-4V7h2v6h-2z"
                fill="#30363d"
              />
            </svg>
            <span style={overlayStyles.blackOverlayText}>Screen Protected</span>
          </div>
        </div>
      )}

      {/* 2. FULL BLACK overlay — when window loses focus */}
      {isBlurred && !isHidden && (
        <div
          style={overlayStyles.blurOverlay}
          aria-hidden="true"
          data-testid="privacy-blur-overlay"
        />
      )}

      {/* 3. Forensic watermark — subtle horizontal grid over message area only */}
      {!isHidden && (
        <div
          style={overlayStyles.watermarkOverlay}
          aria-hidden="true"
          data-testid="privacy-watermark-overlay"
        >
          {/* Rows of subtle forensic ID text in a horizontal grid */}
          {Array.from({ length: 24 }, (_, row) => (
            <div key={row} style={overlayStyles.watermarkRow}>
              {Array.from({ length: 6 }, (_, col) => (
                <span key={col} style={overlayStyles.watermarkText}>
                  {shortLabel}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Fade-in mask when returning from hidden */}
      {fadeIn && (
        <div
          style={overlayStyles.fadeInMask}
          aria-hidden="true"
        />
      )}

      {/* 4. Screen capture warning toast */}
      {showToast && (
        <div style={overlayStyles.captureToast} role="alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path
              d="M12 2L2 22h20L12 2zm0 15a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm-1-8h2v6h-2V9z"
              fill="#f85149"
            />
          </svg>
          <span style={overlayStyles.captureToastText}>
            Screen capture detected — content protection active
          </span>
          <button
            type="button"
            onClick={() => {
              setShowToast(false);
              onDismissCaptureWarning();
            }}
            style={overlayStyles.captureToastDismiss}
            aria-label="Dismiss warning"
          >
            ✕
          </button>
        </div>
      )}
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
  blackOverlayContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  blackOverlayText: {
    color: '#30363d',
    fontSize: 14,
    fontWeight: 500,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    letterSpacing: '0.05em',
    userSelect: 'none',
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

  // Forensic watermark: subtle horizontal grid, message area only
  watermarkOverlay: {
    position: 'fixed',
    // Offset to cover only the message area (skip sidebar ~320px left, header ~50px top, input ~60px bottom)
    top: 50,
    left: 320,
    right: 0,
    bottom: 60,
    zIndex: 999990,
    pointerEvents: 'none',
    overflow: 'hidden',
    userSelect: 'none',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  watermarkRow: {
    display: 'flex',
    justifyContent: 'space-around',
    width: '100%',
  },
  watermarkText: {
    color: '#141a22',
    fontSize: 8,
    fontWeight: 400,
    fontFamily: 'monospace',
    opacity: 0.015,
    whiteSpace: 'nowrap',
    letterSpacing: '0.2em',
    userSelect: 'none',
    pointerEvents: 'none',
    lineHeight: 1,
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
