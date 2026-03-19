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

import React, { useEffect } from 'react';
import { FONT_BODY, FONT_MONO } from '../globalStyles';

// ── Local storage helpers ──

const DEVICE_VERIFIED_PREFIX = 'frame-device-verified:';

export function isDeviceVerified(deviceId: string): boolean {
  try {
    return localStorage.getItem(DEVICE_VERIFIED_PREFIX + deviceId) === 'true';
  } catch {
    return false;
  }
}

export function setDeviceVerified(deviceId: string): void {
  try {
    localStorage.setItem(DEVICE_VERIFIED_PREFIX + deviceId, 'true');
  } catch {
    // localStorage not available
  }
}

/**
 * Check whether the current device needs verification gating.
 * Returns true if the device has NOT been verified.
 */
export function deviceNeedsVerification(deviceId: string): boolean {
  return !isDeviceVerified(deviceId);
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
      0% { transform: scale(0.92) translateY(16px); opacity: 0; }
      100% { transform: scale(1) translateY(0); opacity: 1; }
    }
    @keyframes frameGateOverlayFade {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }
    @keyframes frameGatePulse {
      0%, 100% { box-shadow: 0 0 30px rgba(63,185,80,0.15); }
      50% { box-shadow: 0 0 50px rgba(63,185,80,0.3); }
    }
  `;
  document.head.appendChild(style);
}

// ── Props ──

interface DeviceVerificationGateProps {
  deviceId: string;
  onVerify: () => void;
}

// ── Component ──

const DeviceVerificationGate: React.FC<DeviceVerificationGateProps> = ({
  deviceId,
  onVerify,
}) => {
  useEffect(() => { injectKeyframes(); }, []);

  // Block scrolling on the body while the gate is shown
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div style={gateStyles.overlay} role="alertdialog" aria-modal="true" aria-labelledby="device-gate-title">
      <div style={gateStyles.modal}>
        {/* Scanline effect */}
        <div style={gateStyles.scanlineOverlay} />

        {/* Shield icon */}
        <div style={gateStyles.iconContainer}>
          <svg width="56" height="56" viewBox="0 0 64 64" fill="none">
            <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke="#3fb950" strokeWidth="2.5" fill="rgba(63,185,80,0.06)" />
            <path d="M32 20v12M32 38h.01" stroke="#d29922" strokeWidth="3" strokeLinecap="round" />
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
    animation: 'frameGateOverlayFade 0.3s ease-out',
  },
  modal: {
    position: 'relative' as const,
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderTop: '2px solid #3fb950',
    borderRadius: 2,
    padding: '40px 32px 32px',
    maxWidth: 440,
    width: '100%',
    fontFamily: FONT_BODY,
    color: '#c9d1d9',
    textAlign: 'center' as const,
    overflow: 'hidden',
    animation: 'frameGateEnter 0.4s cubic-bezier(0.16, 1, 0.3, 1), frameGatePulse 3s ease-in-out infinite',
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
    lineHeight: 1.6,
    color: '#c9d1d9',
    fontWeight: 500,
    position: 'relative' as const,
    zIndex: 1,
  },
  subdescription: {
    margin: '0 0 20px',
    fontSize: 13,
    lineHeight: 1.5,
    color: '#8b949e',
    position: 'relative' as const,
    zIndex: 1,
  },
  deviceIdBox: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    padding: 14,
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 2,
    marginBottom: 24,
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
    borderRadius: 2,
    cursor: 'pointer',
    width: '100%',
    minHeight: 48,
    transition: 'background-color 0.15s',
    fontFamily: 'inherit',
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
  },
  footnote: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: '#6e7681',
    position: 'relative' as const,
    zIndex: 1,
  },
};

export default DeviceVerificationGate;
