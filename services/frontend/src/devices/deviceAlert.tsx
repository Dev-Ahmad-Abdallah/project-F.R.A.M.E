/**
 * DeviceAlert — Unknown device detection modal.
 *
 * Shown when an unrecognized device is detected on the user's account.
 * Displays device details and offers Verify / Remove / Ignore actions.
 *
 * Uses urgent red warning styling with dramatic entrance animation
 * and pulsing red border for urgency (Signal / WhatsApp inspired).
 */

import React, { useEffect } from 'react';
import { FONT_BODY, FONT_MONO } from '../globalStyles';
import { useIsMobile } from '../hooks/useIsMobile';

// ── Keyframes (injected once) ──

const DEVICE_ALERT_KEYFRAMES_ID = 'frame-device-alert-keyframes';

function injectKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(DEVICE_ALERT_KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = DEVICE_ALERT_KEYFRAMES_ID;
  style.textContent = `
    @keyframes frameAlertEnter {
      0% { transform: scale(0.85) translateY(20px); opacity: 0; }
      60% { transform: scale(1.02) translateY(-2px); opacity: 1; }
      100% { transform: scale(1) translateY(0); opacity: 1; }
    }
    @keyframes frameAlertOverlayFade {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }
    @keyframes frameAlertBorderPulse {
      0%, 100% { border-color: #f85149; box-shadow: 0 0 40px rgba(248, 81, 73, 0.25); }
      50% { border-color: #ff6b6b; box-shadow: 0 0 60px rgba(248, 81, 73, 0.45); }
    }
    @keyframes frameAlertWarningShake {
      0%, 100% { transform: translateX(0); }
      15% { transform: translateX(-3px) rotate(-2deg); }
      30% { transform: translateX(3px) rotate(2deg); }
      45% { transform: translateX(-2px) rotate(-1deg); }
      60% { transform: translateX(2px) rotate(1deg); }
      75% { transform: translateX(-1px); }
    }
    @keyframes frameAlertUrgentGlow {
      0%, 100% { text-shadow: 0 0 4px rgba(248, 81, 73, 0.3); }
      50% { text-shadow: 0 0 12px rgba(248, 81, 73, 0.6); }
    }
  `;
  document.head.appendChild(style);
}

// ── Types ──

export interface UnknownDeviceInfo {
  deviceId: string;
  deviceDisplayName?: string;
  fingerprint: string;
}

interface DeviceAlertProps {
  device: UnknownDeviceInfo;
  /** Called when the user chooses to verify the device. */
  onVerify: (deviceId: string) => void;
  /** Called when the user chooses to remove the device. */
  onRemove: (deviceId: string) => void;
  /** Called when the user dismisses the alert without action. */
  onIgnore: (deviceId: string) => void;
}

// ── Component ──

const DeviceAlert: React.FC<DeviceAlertProps> = ({
  device,
  onVerify,
  onRemove,
  onIgnore,
}) => {
  const isMobile = useIsMobile();

  useEffect(() => { injectKeyframes(); }, []);

  return (
    <div style={{
      ...styles.overlay,
      ...(isMobile ? { padding: 0 } : {}),
    }}>
      <div style={{
        ...styles.modal,
        ...(isMobile ? {
          maxWidth: '100%',
          width: '100%',
          height: '100%',
          borderRadius: 0,
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column' as const,
          justifyContent: 'center',
        } : {}),
      }} role="alertdialog" aria-labelledby="device-alert-title" aria-describedby="device-alert-desc">
        {/* Warning header */}
        <div style={styles.header}>
          <span style={styles.warningIcon} aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{
              animation: 'frameAlertWarningShake 0.6s ease-out',
            }}>
              <path d="M12 2L1 21h22L12 2z" stroke="#f85149" strokeWidth="1.5" fill="rgba(248,81,73,0.15)" />
              <path d="M12 9v4M12 16v.5" stroke="#f85149" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <h2 id="device-alert-title" style={styles.title}>
            Unknown Device Detected
          </h2>
        </div>

        <p id="device-alert-desc" style={styles.warningText}>
          A device you do not recognize has been added to your account.
          If you did not add this device, your account may be compromised.
        </p>

        {/* Urgency indicator bar */}
        <div style={styles.urgencyBar}>
          <div style={styles.urgencyBarInner} />
          <span style={styles.urgencyLabel}>HIGH PRIORITY</span>
        </div>

        {/* Device details */}
        <div style={styles.detailsBox}>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>Device ID</span>
            <code style={{
              ...styles.detailValue,
              ...(isMobile ? { fontSize: 13 } : {}),
            }}>{device.deviceId}</code>
          </div>
          {device.deviceDisplayName && (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Display Name</span>
              <span style={styles.detailValue}>{device.deviceDisplayName}</span>
            </div>
          )}
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>Public Key Fingerprint</span>
            <code style={{
              ...styles.fingerprintValue,
              ...(isMobile ? { fontSize: 11, lineHeight: 1.5 } : {}),
            }}>
              {formatFingerprint(device.fingerprint)}
            </code>
          </div>
        </div>

        {/* Actions */}
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.verifyButton}
            onClick={() => onVerify(device.deviceId)}
          >
            Verify
          </button>
          <button
            type="button"
            style={styles.removeButton}
            onClick={() => onRemove(device.deviceId)}
          >
            Remove Device
          </button>
          <button
            type="button"
            style={styles.ignoreButton}
            onClick={() => onIgnore(device.deviceId)}
          >
            Ignore (not recommended)
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Helpers ──

function formatFingerprint(hex: string): string {
  return hex.replace(/(.{4})/g, '$1 ').trim();
}

// ── Styles (dark theme, red warning emphasis) ──

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: 16,
    animation: 'frameAlertOverlayFade 0.3s ease-out',
  },
  modal: {
    backgroundColor: '#161b22',
    border: '2px solid #f85149',
    borderRadius: 12,
    padding: 28,
    maxWidth: 460,
    width: '100%',
    fontFamily: FONT_BODY,
    color: '#c9d1d9',
    animation: 'frameAlertEnter 0.4s cubic-bezier(0.16, 1, 0.3, 1), frameAlertBorderPulse 2s ease-in-out infinite',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  warningIcon: {
    fontSize: 28,
    color: '#f85149',
    lineHeight: 1,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: '#f85149',
    animation: 'frameAlertUrgentGlow 2s ease-in-out infinite',
  },
  warningText: {
    margin: '0 0 16px',
    fontSize: 14,
    lineHeight: 1.6,
    color: '#d29922',
  },
  urgencyBar: {
    position: 'relative' as const,
    height: 3,
    backgroundColor: '#21262d',
    borderRadius: 2,
    marginBottom: 20,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
  },
  urgencyBarInner: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    height: '100%',
    width: '100%',
    background: 'linear-gradient(90deg, #f85149 0%, #ff6b6b 50%, #f85149 100%)',
    borderRadius: 2,
  },
  urgencyLabel: {
    position: 'absolute' as const,
    right: 0,
    top: -18,
    fontSize: 9,
    fontWeight: 700,
    color: '#f85149',
    letterSpacing: '0.1em',
  },
  detailsBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 16,
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 8,
    marginBottom: 20,
  },
  detailRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  detailValue: {
    fontSize: 14,
    color: '#e6edf3',
    wordBreak: 'break-all',
  },
  fingerprintValue: {
    fontSize: 13,
    color: '#58a6ff',
    fontFamily: FONT_MONO,
    wordBreak: 'break-all',
    lineHeight: 1.6,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  verifyButton: {
    padding: '12px 16px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    width: '100%',
    minHeight: 44,
    transition: 'background-color 0.15s',
  },
  removeButton: {
    padding: '12px 16px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#da3633',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    width: '100%',
    minHeight: 44,
    transition: 'background-color 0.15s',
  },
  ignoreButton: {
    padding: '12px 16px',
    fontSize: 14,
    fontWeight: 500,
    backgroundColor: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    width: '100%',
    minHeight: 44,
    transition: 'border-color 0.15s, color 0.15s',
  },
};

export default DeviceAlert;
