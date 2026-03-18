/**
 * DeviceLinking — QR code device linking and verification UI.
 *
 * Displays a QR code containing the current device's public key
 * fingerprint, a camera scanner placeholder, and manual fingerprint
 * comparison with approve/reject actions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { generateFingerprint } from '../crypto/cryptoUtils';

// ── Types ──

interface DeviceLinkingProps {
  /** The current device's public key (base64 or hex string). */
  devicePublicKey: string;
  /** Called when the user approves a scanned device. */
  onApprove: (scannedFingerprint: string) => void;
  /** Called when the user rejects a scanned device. */
  onReject: () => void;
}

// ── Component ──

const DeviceLinking: React.FC<DeviceLinkingProps> = ({
  devicePublicKey,
  onApprove,
  onReject,
}) => {
  const [fingerprint, setFingerprint] = useState<string>('');
  const [scannedFingerprint, setScannedFingerprint] = useState<string>('');
  const [showScanner, setShowScanner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    generateFingerprint(devicePublicKey).then((fp) => {
      if (!cancelled) setFingerprint(fp);
    });
    return () => {
      cancelled = true;
    };
  }, [devicePublicKey]);

  const formattedFingerprint = formatFingerprint(fingerprint);

  const handleApprove = useCallback(() => {
    if (scannedFingerprint.trim()) {
      onApprove(scannedFingerprint.trim());
    }
  }, [scannedFingerprint, onApprove]);

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Link a New Device</h2>

      {/* QR Code Section */}
      <div style={styles.section}>
        <h3 style={styles.subheading}>Your Device Fingerprint</h3>
        <p style={styles.description}>
          Scan this QR code from your other device, or compare the
          fingerprint text manually.
        </p>

        {/* QR Code — rendered as a text-based placeholder.
            In production, use a library like `qrcode.react` to generate
            a real QR code from the fingerprint string. */}
        <div style={styles.qrPlaceholder}>
          <div style={styles.qrInner}>
            <span style={styles.qrLabel}>QR Code</span>
            <span style={styles.qrData}>
              {fingerprint ? fingerprint.slice(0, 16) + '...' : 'Generating...'}
            </span>
          </div>
        </div>

        {/* Fingerprint text display */}
        <div style={styles.fingerprintBox}>
          <code style={styles.fingerprintText}>
            {formattedFingerprint || 'Generating fingerprint...'}
          </code>
        </div>
      </div>

      {/* Scanner Section */}
      <div style={styles.section}>
        <h3 style={styles.subheading}>Scan Other Device</h3>

        {showScanner ? (
          <div style={styles.scannerPlaceholder}>
            <p style={styles.scannerText}>
              Camera access requires the MediaDevices API.
            </p>
            <p style={styles.scannerText}>
              Grant camera permission in your browser to scan a QR code.
            </p>
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => setShowScanner(false)}
            >
              Cancel Scan
            </button>
          </div>
        ) : (
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => setShowScanner(true)}
          >
            Open Camera Scanner
          </button>
        )}

        {/* Manual fingerprint entry fallback */}
        <div style={styles.manualEntry}>
          <label style={styles.label} htmlFor="scanned-fingerprint">
            Or enter fingerprint manually:
          </label>
          <input
            id="scanned-fingerprint"
            type="text"
            style={styles.input}
            placeholder="Paste the other device's fingerprint"
            value={scannedFingerprint}
            onChange={(e) => setScannedFingerprint(e.target.value)}
          />
        </div>
      </div>

      {/* Actions */}
      <div style={styles.actions}>
        <button
          type="button"
          style={{
            ...styles.approveButton,
            ...(!scannedFingerprint.trim() ? styles.buttonDisabled : {}),
          }}
          onClick={handleApprove}
          disabled={!scannedFingerprint.trim()}
        >
          Approve Device
        </button>
        <button
          type="button"
          style={styles.rejectButton}
          onClick={onReject}
        >
          Reject Device
        </button>
      </div>
    </div>
  );
};

// ── Helpers ──

/**
 * Format a hex fingerprint into groups of 4 for readability.
 * e.g. "abcd1234ef56" → "abcd 1234 ef56"
 */
function formatFingerprint(hex: string): string {
  return hex.replace(/(.{4})/g, '$1 ').trim();
}

// ── Styles (dark theme) ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    padding: 24,
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    color: '#c9d1d9',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: 480,
  },
  heading: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
    color: '#f0f6fc',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  subheading: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    color: '#e6edf3',
  },
  description: {
    margin: 0,
    fontSize: 13,
    color: '#8b949e',
    lineHeight: 1.5,
  },
  qrPlaceholder: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 180,
    height: 180,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    alignSelf: 'center',
  },
  qrInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  qrLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: '#333',
  },
  qrData: {
    fontSize: 10,
    color: '#666',
    fontFamily: 'monospace',
  },
  fingerprintBox: {
    padding: 12,
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 6,
    overflowX: 'auto',
  },
  fingerprintText: {
    fontSize: 13,
    color: '#58a6ff',
    wordBreak: 'break-all',
    lineHeight: 1.6,
    fontFamily: 'monospace',
  },
  scannerPlaceholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: 24,
    backgroundColor: '#0d1117',
    border: '1px dashed #30363d',
    borderRadius: 8,
  },
  scannerText: {
    margin: 0,
    fontSize: 13,
    color: '#8b949e',
    textAlign: 'center',
  },
  manualEntry: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 8,
  },
  label: {
    fontSize: 13,
    color: '#8b949e',
  },
  input: {
    padding: '8px 12px',
    fontSize: 14,
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 6,
    color: '#c9d1d9',
    outline: 'none',
    fontFamily: 'monospace',
  },
  actions: {
    display: 'flex',
    gap: 12,
    marginTop: 8,
  },
  approveButton: {
    flex: 1,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  rejectButton: {
    flex: 1,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#da3633',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 500,
    backgroundColor: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
};

export default DeviceLinking;
