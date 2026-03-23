/**
 * Toast — Non-blocking notification component for F.R.A.M.E.
 *
 * Renders a stack of toast notifications in the top-right corner.
 * Each toast has:
 *   - Colored left border (success=green, error=red, info=blue, warning=amber)
 *   - Icon (checkmark, X, info, warning)
 *   - Auto-dismiss progress bar (unless persistent)
 *   - Slide-in animation from the right
 *   - Dismiss on click of the X button
 *
 * Dark theme: matches #161b22 cards, #30363d borders, #c9d1d9 text.
 */

import React, { useState, useEffect } from 'react';
import type { Toast as ToastData, ToastType } from '../hooks/useToast';
import { useIsMobile } from '../hooks/useIsMobile';

interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

// ── Icons ──

const icons: Record<ToastType, React.ReactNode> = {
  success: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="8" stroke="#3fb950" strokeWidth="1.5" fill="rgba(63,185,80,0.1)" />
      <path d="M5.5 9.5l2 2 5-5" stroke="#3fb950" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="8" stroke="#f85149" strokeWidth="1.5" fill="rgba(248,81,73,0.1)" />
      <path d="M6.5 6.5l5 5M11.5 6.5l-5 5" stroke="#f85149" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="8" stroke="#58a6ff" strokeWidth="1.5" fill="rgba(88,166,255,0.1)" />
      <path d="M9 8v4" stroke="#58a6ff" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="9" cy="5.5" r="0.75" fill="#58a6ff" />
    </svg>
  ),
  warning: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 2L1.5 15.5h15L9 2z" stroke="#d29922" strokeWidth="1.5" fill="rgba(210,153,34,0.1)" strokeLinejoin="round" />
      <path d="M9 7v3.5" stroke="#d29922" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="9" cy="13" r="0.75" fill="#d29922" />
    </svg>
  ),
};

const borderColors: Record<ToastType, string> = {
  success: '#3fb950',
  error: '#f85149',
  info: '#58a6ff',
  warning: '#d29922',
};

const bgColors: Record<ToastType, string> = {
  success: 'rgba(63,185,80,0.06)',
  error: 'rgba(248,81,73,0.06)',
  info: 'rgba(88,166,255,0.06)',
  warning: 'rgba(210,153,34,0.06)',
};

// ── Individual Toast ──

function ToastItem({
  toast,
  onDismiss,
  isMobile,
}: {
  toast: ToastData;
  onDismiss: (id: string) => void;
  isMobile: boolean;
}) {
  const [isExiting, setIsExiting] = useState(false);
  const [progressWidth, setProgressWidth] = useState(100);

  // Animate progress bar for non-persistent toasts
  useEffect(() => {
    if (toast.persistent) return;

    // Start the progress bar shrinking after a tiny delay so the
    // initial render shows 100% width before transitioning.
    const raf = requestAnimationFrame(() => {
      setProgressWidth(0);
    });

    return () => cancelAnimationFrame(raf);
  }, [toast.persistent, toast.duration]);

  // Slide-out before removal
  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 250);
  };

  return (
    <div
      role={toast.onClick ? 'button' : undefined}
      tabIndex={toast.onClick ? 0 : undefined}
      onClick={toast.onClick ? () => { const fn = toast.onClick; if (fn) fn(); handleDismiss(); } : undefined}
      onKeyDown={toast.onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { const fn = toast.onClick; if (fn) fn(); handleDismiss(); } } : undefined}
      style={{
        ...toastStyles.toast,
        borderLeftColor: borderColors[toast.type],
        backgroundColor: bgColors[toast.type],
        cursor: toast.onClick ? 'pointer' : undefined,
        animation: isExiting
          ? (isMobile ? 'frame-toast-slide-out-mobile 0.25s ease-in forwards' : 'frame-toast-slide-out 0.25s ease-in forwards')
          : (isMobile ? 'frame-toast-slide-in-mobile 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' : 'frame-toast-slide-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'),
        ...(isMobile ? {
          padding: '10px 44px 10px 12px',
          borderRadius: 0,
          borderLeft: 'none',
          borderBottom: `3px solid ${borderColors[toast.type]}`,
        } : {}),
      }}
    >
      {/* Icon */}
      <div style={toastStyles.iconWrap} aria-hidden="true">{icons[toast.type]}</div>

      {/* Message */}
      <div style={{
        ...toastStyles.message,
        ...(isMobile ? { fontSize: 12, lineHeight: 1.4 } : {}),
      }}>{toast.message}</div>

      {/* Dismiss button */}
      <button
        type="button"
        style={{
          ...toastStyles.dismissButton,
          ...(isMobile ? {
            width: 44,
            height: 44,
            top: '50%',
            right: 0,
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          } : {}),
        }}
        onClick={handleDismiss}
        aria-label="Dismiss notification"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Progress bar */}
      {!toast.persistent && (
        <div style={toastStyles.progressTrack}>
          <div
            style={{
              ...toastStyles.progressBar,
              backgroundColor: borderColors[toast.type],
              width: `${progressWidth}%`,
              transition: progressWidth === 0
                ? `width ${toast.duration}ms linear`
                : 'none',
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Toast Container ──

export default function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  const isMobile = useIsMobile(600);

  // Inject keyframes on first render
  useEffect(() => {
    const styleId = 'frame-toast-keyframes';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes frame-toast-slide-in {
          from {
            transform: translateX(120%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes frame-toast-slide-out {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(120%);
            opacity: 0;
          }
        }
        @keyframes frame-toast-slide-in-mobile {
          from {
            transform: translateY(-100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes frame-toast-slide-out-mobile {
          from {
            transform: translateY(0);
            opacity: 1;
          }
          to {
            transform: translateY(-100%);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      ...toastStyles.container,
      ...(isMobile ? {
        top: 0,
        right: 0,
        left: 0,
        maxWidth: '100%',
        gap: 0,
      } : {}),
    }} role="status" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} isMobile={isMobile} />
      ))}
    </div>
  );
}

// ── Styles ──

const toastStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: 16,
    right: 16,
    zIndex: 10001,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxWidth: 380,
    width: '100%',
    pointerEvents: 'none',
  },
  toast: {
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '12px 36px 12px 14px',
    borderRadius: 8,
    borderLeft: '4px solid',
    backgroundColor: '#161b22',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2)',
    overflow: 'hidden',
    pointerEvents: 'auto',
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  iconWrap: {
    flexShrink: 0,
    marginTop: 1,
  },
  message: {
    flex: 1,
    fontSize: 13,
    lineHeight: 1.45,
    color: '#c9d1d9',
    fontWeight: 500,
  },
  dismissButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 4,
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
    transition: 'opacity 0.15s',
  },
  progressTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(48, 54, 61, 0.5)',
  },
  progressBar: {
    height: '100%',
    borderRadius: '0 2px 2px 0',
  },
};
