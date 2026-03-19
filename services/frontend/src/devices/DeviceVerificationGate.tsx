/**
 * DeviceVerificationGate — Full-screen overlay for new device verification.
 *
 * Shown when a user logs in from a new/unrecognised device. Blocks access
 * to messages until the device is either verified or explicitly skipped.
 *
 * Options:
 *   - "Verify with existing device" — opens the QR / fingerprint verification flow
 *   - "Skip for now" — marks device as skipped (unverified), shows persistent warning
 */

import React, { useEffect } from 'react';
import { FONT_BODY, FONT_MONO } from '../globalStyles';

// ── Local storage helpers ──

const DEVICE_VERIFIED_PREFIX = 'frame-device-verified:';
const DEVICE_SKIPPED_PREFIX = 'frame-device-skipped:';

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
    // Clear skip flag if it was set
    localStorage.removeItem(DEVICE_SKIPPED_PREFIX + deviceId);
  } catch {
    // localStorage not available
  }
}

export function isDeviceSkipped(deviceId: string): boolean {
  try {
    return localStorage.getItem(DEVICE_SKIPPED_PREFIX + deviceId) === 'true';
  } catch {
    return false;
  }
}

export function setDeviceSkipped(deviceId: string): void {
  try {
    localStorage.setItem(DEVICE_SKIPPED_PREFIX + deviceId, 'true');
  } catch {
    // localStorage not available
  }
}

/**
 * Check whether the current device needs verification gating.
 * Returns true if the device has NOT been verified and NOT been skipped.
 */
export function deviceNeedsVerification(deviceId: string): boolean {
  return !isDeviceVerified(deviceId) && !isDeviceSkipped(deviceId);
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
      0%, 100% { box-shadow: 0 0 30px rgba(88,166,255,0.15); }
      50% { box-shadow: 0 0 50px rgba(88,166,255,0.3); }
    }
  `;
  document.head.appendChild(style);
}

// ── Props ──

interface DeviceVerificationGateProps {
  deviceId: string;
  onVerify: () => void;
  onSkip: () => void;
}

// ── Component ──

const DeviceVerificationGate: React.FC<DeviceVerificationGateProps> = ({
  deviceId,
  onVerify,
  onSkip,
}) => {
  useEffect(() => { injectKeyframes(); }, []);

  return (
    <div style={gateStyles.overlay} role="alertdialog" aria-modal="true" aria-labelledby="device-gate-title">
      <div style={gateStyles.modal}>
        {/* Shield icon */}
        <div style={gateStyles.iconContainer}>
          <svg width="48" height="48" viewBox="0 0 64 64" fill="none">
            <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke="#58a6ff" strokeWidth="2.5" fill="rgba(88,166,255,0.08)" />
            <path d="M32 20v12M32 38h.01" stroke="#d29922" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>

        <h2 id="device-gate-title" style={gateStyles.title}>New Device Detected</h2>

        <p style={gateStyles.description}>
          This device has not been verified yet. For maximum security,
          verify it with an existing trusted device.
        </p>

        {/* Device ID display */}
        <div style={gateStyles.deviceIdBox}>
          <span style={gateStyles.deviceIdLabel}>Device ID</span>
          <code style={gateStyles.deviceIdValue}>{deviceId}</code>
        </div>

        {/* Actions */}
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
            Verify with existing device
          </button>

          <button
            type="button"
            style={gateStyles.skipButton}
            onClick={onSkip}
          >
            Skip for now
          </button>
        </div>

        <p style={gateStyles.footnote}>
          Messages remain end-to-end encrypted regardless of verification status.
          Verification confirms this device is trusted by you.
        </p>
      </div>
    </div>
  );
};

// ── Warning Banner Component ──

interface UnverifiedBannerProps {
  onVerify: () => void;
}

export const UnverifiedDeviceBanner: React.FC<UnverifiedBannerProps> = ({ onVerify }) => (
  <div style={bannerStyles.container} role="alert">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M8 1.5L3 4.5v4c0 3.5 2.1 5.8 5 7 2.9-1.2 5-3.5 5-7v-4L8 1.5z" stroke="#d29922" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
      <path d="M8 5v3M8 10h.01" stroke="#d29922" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
    <span style={bannerStyles.text}>
      This device is unverified. Verify to ensure message security.
    </span>
    <button type="button" style={bannerStyles.verifyBtn} onClick={onVerify}>
      Verify
    </button>
  </div>
);

// ── Styles ──

const gateStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: 16,
    animation: 'frameGateOverlayFade 0.3s ease-out',
  },
  modal: {
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 16,
    padding: 32,
    maxWidth: 440,
    width: '100%',
    fontFamily: FONT_BODY,
    color: '#c9d1d9',
    textAlign: 'center' as const,
    animation: 'frameGateEnter 0.4s cubic-bezier(0.16, 1, 0.3, 1), frameGatePulse 3s ease-in-out infinite',
  },
  iconContainer: {
    marginBottom: 20,
  },
  title: {
    margin: '0 0 12px',
    fontSize: 22,
    fontWeight: 700,
    color: '#f0f6fc',
  },
  description: {
    margin: '0 0 20px',
    fontSize: 14,
    lineHeight: 1.6,
    color: '#8b949e',
  },
  deviceIdBox: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    padding: 14,
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 8,
    marginBottom: 24,
  },
  deviceIdLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  deviceIdValue: {
    fontSize: 13,
    color: '#58a6ff',
    fontFamily: FONT_MONO,
    wordBreak: 'break-all' as const,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    marginBottom: 20,
  },
  verifyButton: {
    padding: '14px 20px',
    fontSize: 15,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    width: '100%',
    minHeight: 48,
    transition: 'background-color 0.15s',
    fontFamily: 'inherit',
  },
  skipButton: {
    padding: '12px 20px',
    fontSize: 14,
    fontWeight: 500,
    backgroundColor: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 8,
    cursor: 'pointer',
    width: '100%',
    minHeight: 44,
    transition: 'border-color 0.15s, color 0.15s',
    fontFamily: 'inherit',
  },
  footnote: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: '#6e7681',
  },
};

const bannerStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 16px',
    backgroundColor: 'rgba(210, 153, 34, 0.1)',
    borderBottom: '1px solid rgba(210, 153, 34, 0.25)',
    fontSize: 13,
    color: '#d29922',
    flexShrink: 0,
  },
  text: {
    flex: 1,
  },
  verifyBtn: {
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 600,
    backgroundColor: 'rgba(210, 153, 34, 0.15)',
    color: '#d29922',
    border: '1px solid rgba(210, 153, 34, 0.3)',
    borderRadius: 6,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    fontFamily: 'inherit',
  },
};

export default DeviceVerificationGate;
