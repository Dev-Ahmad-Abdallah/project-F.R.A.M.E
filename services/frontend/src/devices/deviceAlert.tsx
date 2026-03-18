/**
 * DeviceAlert — Unknown device detection modal.
 *
 * Shown when an unrecognized device is detected on the user's account.
 * Displays device details and offers Verify / Remove / Ignore actions.
 *
 * Uses urgent red warning styling to draw attention.
 */

import React from 'react';

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
  return (
    <div style={styles.overlay}>
      <div style={styles.modal} role="alertdialog" aria-labelledby="device-alert-title">
        {/* Warning header */}
        <div style={styles.header}>
          <span style={styles.warningIcon} aria-hidden="true">
            &#9888;
          </span>
          <h2 id="device-alert-title" style={styles.title}>
            Unknown Device Detected
          </h2>
        </div>

        <p style={styles.warningText}>
          A device you do not recognize has been added to your account.
          If you did not add this device, your account may be compromised.
        </p>

        {/* Device details */}
        <div style={styles.detailsBox}>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>Device ID</span>
            <code style={styles.detailValue}>{device.deviceId}</code>
          </div>
          {device.deviceDisplayName && (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Display Name</span>
              <span style={styles.detailValue}>{device.deviceDisplayName}</span>
            </div>
          )}
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>Public Key Fingerprint</span>
            <code style={styles.fingerprintValue}>
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
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: 16,
  },
  modal: {
    backgroundColor: '#161b22',
    border: '2px solid #da3633',
    borderRadius: 12,
    padding: 28,
    maxWidth: 460,
    width: '100%',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#c9d1d9',
    boxShadow: '0 0 40px rgba(218, 54, 51, 0.3)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  warningIcon: {
    fontSize: 28,
    color: '#da3633',
    lineHeight: 1,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: '#f85149',
  },
  warningText: {
    margin: '0 0 20px',
    fontSize: 14,
    lineHeight: 1.6,
    color: '#f0883e',
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
    fontFamily: 'monospace',
    wordBreak: 'break-all',
    lineHeight: 1.6,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  verifyButton: {
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    width: '100%',
  },
  removeButton: {
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#da3633',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    width: '100%',
  },
  ignoreButton: {
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 500,
    backgroundColor: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    width: '100%',
  },
};

export default DeviceAlert;
