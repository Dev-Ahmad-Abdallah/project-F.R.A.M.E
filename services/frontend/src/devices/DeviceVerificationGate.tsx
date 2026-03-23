/**
 * DeviceVerificationGate — Full-screen BLOCKING overlay for new device verification.
 *
 * Shown when a user logs in from a new/unrecognised device AND other verified
 * devices already exist. Blocks ALL access to messages until the device is
 * verified via QR code or fingerprint comparison. There is NO skip option.
 *
 * If this is the user's first/only device, it is auto-verified — the gate
 * never appears.
 */

import React, { useEffect, useRef } from 'react';
import { FONT_BODY, FONT_MONO } from '../globalStyles';
import { listDevices, verifyDeviceOnServer } from '../api/devicesAPI';

// ── LocalStorage key helpers ──

const VERIFIED_KEY_PREFIX = 'frame-device-verified:';

export function getLocalVerified(deviceId: string): boolean {
  try {
    return localStorage.getItem(`${VERIFIED_KEY_PREFIX}${deviceId}`) === 'true';
  } catch {
    return false;
  }
}

export function setLocalVerified(deviceId: string): void {
  try {
    localStorage.setItem(`${VERIFIED_KEY_PREFIX}${deviceId}`, 'true');
  } catch { /* localStorage may be unavailable */ }
}

// ── Server-side device verification helpers ──

/**
 * Check if a device is verified by querying the server.
 * Returns true only if the server confirms the device is verified.
 * Falls back to false on any error (safe default).
 */
export async function isDeviceVerified(deviceId: string, userId: string): Promise<boolean> {
  try {
    const resp = await listDevices(userId);
    const device = resp.devices?.find((d) => d.deviceId === deviceId);
    return device?.verified === true;
  } catch {
    return false;
  }
}

/**
 * Mark a device as verified on the server AND in localStorage.
 */
export async function setDeviceVerified(deviceId: string): Promise<void> {
  try {
    await verifyDeviceOnServer(deviceId);
    setLocalVerified(deviceId);
  } catch {
    // Server call failed — verification not persisted
    console.error('[F.R.A.M.E.] Failed to set device as verified on server');
  }
}

/**
 * Check whether the current device needs verification gating.
 *
 * - First checks localStorage for a fast cached answer.
 * - Then verifies with the server (source of truth).
 * - If localStorage says verified but server disagrees, clears localStorage
 *   and returns true (needs verification).
 *
 * Returns true if the device has NOT been verified.
 */
export async function deviceNeedsVerification(deviceId: string, userId: string): Promise<boolean> {
  // Quick localStorage check
  const locallyVerified = getLocalVerified(deviceId);

  // Always confirm with the server (source of truth)
  const serverVerified = await isDeviceVerified(deviceId, userId);

  if (serverVerified) {
    // Server says verified — make sure localStorage is in sync
    if (!locallyVerified) {
      setLocalVerified(deviceId);
    }
    return false;
  }

  // Server says NOT verified
  if (locallyVerified) {
    // localStorage was stale/tampered — clear it
    try {
      localStorage.removeItem(`${VERIFIED_KEY_PREFIX}${deviceId}`);
    } catch { /* */ }
  }

  return true;
}

// ── Keyframes ──

const GATE_KEYFRAMES_ID = 'frame-device-gate-keyframes';

function injectKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(GATE_KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = GATE_KEYFRAMES_ID;
  style.textContent = `
    @keyframes frameGateEnter {
      0% { transform: scale(0.96) translateY(12px); opacity: 0; }
      100% { transform: scale(1) translateY(0); opacity: 1; }
    }
    @keyframes frameGateOverlayFade {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }
    @keyframes frameGateGlow {
      0%, 100% { box-shadow: 0 0 24px rgba(63,185,80,0.10); }
      50% { box-shadow: 0 0 36px rgba(63,185,80,0.18); }
    }
    @keyframes frameGateShieldGlow {
      0%, 100% { filter: drop-shadow(0 0 6px rgba(63,185,80,0.15)); }
      50% { filter: drop-shadow(0 0 12px rgba(63,185,80,0.30)); }
    }
    @keyframes frameGatePulse {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

// ── Props ──

interface DeviceVerificationGateProps {
  deviceId: string;
  userId: string;
  onVerify: () => void;
  /** Called when polling detects that the device was verified remotely. */
  onRemoteVerified: () => void;
}

// ── Component ──

const DeviceVerificationGate: React.FC<DeviceVerificationGateProps> = ({
  deviceId,
  userId,
  onVerify,
  onRemoteVerified,
}) => {
  useEffect(() => { injectKeyframes(); }, []);

  // Block scrolling on the body while the gate is shown
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Block keyboard shortcuts while gate is shown
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only allow Escape (no-op) and Tab (accessibility)
      if (e.key !== 'Tab' && e.key !== 'Escape') {
        const mod = e.metaKey || e.ctrlKey;
        if (mod) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    // Capture phase to intercept before App's keyboard handler
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  // Poll the server every 5 seconds to detect remote verification
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!deviceId || !userId) return;

    const checkRemoteVerification = async () => {
      try {
        const verified = await isDeviceVerified(deviceId, userId);
        if (verified) {
          setLocalVerified(deviceId);
          onRemoteVerified();
        }
      } catch {
        // Silently ignore polling errors
      }
    };

    pollingRef.current = setInterval(() => {
      void checkRemoteVerification();
    }, 5000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [deviceId, userId, onRemoteVerified]);

  return (
    <div style={gateStyles.overlay} role="alertdialog" aria-modal="true" aria-labelledby="device-gate-title">
      <div style={gateStyles.modal}>
        {/* Scanline effect */}
        <div style={gateStyles.scanlineOverlay} />

        {/* Shield icon with subtle green glow */}
        <div style={gateStyles.iconContainer}>
          <svg width="56" height="56" viewBox="0 0 64 64" fill="none" style={{ animation: 'frameGateShieldGlow 3s ease-in-out infinite' }}>
            <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke="#3fb950" strokeWidth="2.5" fill="rgba(63,185,80,0.08)" />
            <path d="M32 22v10M32 36h.01" stroke="#8b949e" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        <h2 id="device-gate-title" style={gateStyles.title}>NEW DEVICE DETECTED</h2>

        <p style={gateStyles.description}>
          This device must be verified before you can access your messages.
        </p>

        <p style={gateStyles.subdescription}>
          Verify with an existing device by scanning a QR code or comparing fingerprints.
        </p>

        {/* Device ID display */}
        <div style={gateStyles.deviceIdBox}>
          <span style={gateStyles.deviceIdLabel}>DEVICE ID</span>
          <code style={gateStyles.deviceIdValue}>{deviceId}</code>
        </div>

        {/* Waiting for remote verification indicator */}
        <p style={gateStyles.pollingIndicator}>
          Waiting for verification from another device...
        </p>

        {/* Single action — verify only */}
        <div style={gateStyles.actions}>
          <button
            type="button"
            style={gateStyles.verifyButton}
            onClick={onVerify}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ marginRight: 8, verticalAlign: 'middle' }}>
              <path d="M9 1.5L3 4.5v4.5c0 4.14 2.56 7.01 6 8.5 3.44-1.49 6-4.36 6-8.5V4.5L9 1.5z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
              <path d="M6.5 9.5l2 2 3.5-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            VERIFY DEVICE
          </button>
        </div>

        <p style={gateStyles.footnote}>
          Verification confirms this device is trusted by you. Access is blocked until verification is complete.
        </p>
      </div>
    </div>
  );
};

// ── Styles ──

const gateStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0d1117',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999999,
    padding: 16,
    animation: 'frameGateOverlayFade 0.35s ease-out',
  },
  modal: {
    position: 'relative' as const,
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderTop: '2px solid #3fb950',
    borderRadius: 12,
    padding: '40px 32px 32px',
    maxWidth: 440,
    width: '100%',
    fontFamily: FONT_BODY,
    color: '#c9d1d9',
    textAlign: 'center' as const,
    overflow: 'hidden',
    animation: 'frameGateEnter 0.4s cubic-bezier(0.32, 0.72, 0, 1), frameGateGlow 4s ease-in-out infinite',
  },
  scanlineOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none' as const,
    background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(63,185,80,0.008) 3px, rgba(63,185,80,0.008) 4px)',
    zIndex: 0,
  },
  iconContainer: {
    marginBottom: 20,
    position: 'relative' as const,
    zIndex: 1,
  },
  title: {
    margin: '0 0 12px',
    fontSize: 18,
    fontWeight: 700,
    color: '#f0f6fc',
    letterSpacing: '0.15em',
    textTransform: 'uppercase' as const,
    position: 'relative' as const,
    zIndex: 1,
  },
  description: {
    margin: '0 0 8px',
    fontSize: 14,
    lineHeight: 1.5,
    color: '#c9d1d9',
    fontWeight: 400,
    position: 'relative' as const,
    zIndex: 1,
  },
  subdescription: {
    margin: '0 0 20px',
    fontSize: 12,
    lineHeight: 1.4,
    color: '#8b949e',
    position: 'relative' as const,
    zIndex: 1,
  },
  deviceIdBox: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    padding: '14px 16px',
    backgroundColor: '#0d1117',
    border: '1px solid #21262d',
    borderRadius: 8,
    marginBottom: 16,
    position: 'relative' as const,
    zIndex: 1,
  },
  deviceIdLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.12em',
  },
  deviceIdValue: {
    fontSize: 13,
    color: '#3fb950',
    fontFamily: FONT_MONO,
    wordBreak: 'break-all' as const,
  },
  pollingIndicator: {
    margin: '0 0 20px',
    fontSize: 12,
    color: '#8b949e',
    fontStyle: 'italic' as const,
    animation: 'frameGatePulse 2s ease-in-out infinite',
    position: 'relative' as const,
    zIndex: 1,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    marginBottom: 20,
    position: 'relative' as const,
    zIndex: 1,
  },
  verifyButton: {
    padding: '14px 20px',
    fontSize: 14,
    fontWeight: 700,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: '1px solid rgba(63,185,80,0.3)',
    borderRadius: 8,
    cursor: 'pointer',
    width: '100%',
    minHeight: 48,
    transition: 'background-color 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s, transform 0.1s',
    fontFamily: 'inherit',
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
  },
  footnote: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.4,
    color: '#6e7681',
    position: 'relative' as const,
    zIndex: 1,
  },
};

export default DeviceVerificationGate;
