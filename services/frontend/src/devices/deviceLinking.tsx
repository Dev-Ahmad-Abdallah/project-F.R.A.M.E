/**
 * DeviceLinking — QR code device linking and verification UI.
 *
 * Displays a QR code containing the current device's public key
 * fingerprint, a camera scanner placeholder, and manual fingerprint
 * comparison with approve/reject actions.
 *
 * Visual polish: scanning grid pattern on QR placeholder, animated
 * border with corner brackets (Signal / WhatsApp QR scanner inspired).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { generateFingerprint } from '../crypto/cryptoUtils';
import { FONT_BODY, FONT_MONO } from '../globalStyles';
import { useIsMobile } from '../hooks/useIsMobile';

// ── Keyframes (injected once) ──

const DEVICE_LINKING_KEYFRAMES_ID = 'frame-device-linking-keyframes';

function injectKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(DEVICE_LINKING_KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = DEVICE_LINKING_KEYFRAMES_ID;
  style.textContent = `
    @keyframes frameQrBorderRotate {
      0% { border-color: #58a6ff; box-shadow: 0 0 12px rgba(88, 166, 255, 0.2); }
      33% { border-color: #bc8cff; box-shadow: 0 0 12px rgba(188, 140, 255, 0.2); }
      66% { border-color: #3fb950; box-shadow: 0 0 12px rgba(63, 185, 80, 0.2); }
      100% { border-color: #58a6ff; box-shadow: 0 0 12px rgba(88, 166, 255, 0.2); }
    }
    @keyframes frameQrScanLine {
      0% { top: 8px; }
      50% { top: calc(100% - 12px); }
      100% { top: 8px; }
    }
    @keyframes frameScannerPulse {
      0%, 100% { border-color: #30363d; }
      50% { border-color: #58a6ff; }
    }
    @keyframes frameQrCornerPulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

// ── Types ──

/** Maximum age (in ms) for a QR payload to be considered valid. */
const QR_PAYLOAD_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

interface DeviceLinkingProps {
  /** The current device's public key (base64 or hex string). */
  devicePublicKey: string;
  /** The current device's unique identifier. */
  deviceId?: string;
  /** Called when the user approves a scanned device. */
  onApprove: (scannedFingerprint: string) => void;
  /** Called when the user rejects a scanned device. */
  onReject: () => void;
}

// ── QR Corner Brackets Component ──

const QrCornerBrackets: React.FC = () => {
  const cornerStyle: React.CSSProperties = {
    position: 'absolute',
    width: 20,
    height: 20,
    animation: 'frameQrCornerPulse 2s ease-in-out infinite',
  };
  const borderColor = '#58a6ff';
  const bw = '3px solid ' + borderColor;

  return (
    <>
      {/* Top-left */}
      <div style={{ ...cornerStyle, top: -2, left: -2, borderTop: bw, borderLeft: bw, borderTopLeftRadius: 4 }} />
      {/* Top-right */}
      <div style={{ ...cornerStyle, top: -2, right: -2, borderTop: bw, borderRight: bw, borderTopRightRadius: 4 }} />
      {/* Bottom-left */}
      <div style={{ ...cornerStyle, bottom: -2, left: -2, borderBottom: bw, borderLeft: bw, borderBottomLeftRadius: 4 }} />
      {/* Bottom-right */}
      <div style={{ ...cornerStyle, bottom: -2, right: -2, borderBottom: bw, borderRight: bw, borderBottomRightRadius: 4 }} />
    </>
  );
};

// ── Scanning Grid Pattern Component ──

const ScanningGrid: React.FC = () => {
  const lines: React.ReactElement[] = [];
  const gridColor = 'rgba(88, 166, 255, 0.08)';

  // Vertical lines
  for (let i = 1; i < 8; i++) {
    lines.push(
      <div
        key={`v${i}`}
        style={{
          position: 'absolute',
          left: `${(i / 8) * 100}%`,
          top: 0,
          bottom: 0,
          width: 1,
          backgroundColor: gridColor,
        }}
      />
    );
  }
  // Horizontal lines
  for (let i = 1; i < 8; i++) {
    lines.push(
      <div
        key={`h${i}`}
        style={{
          position: 'absolute',
          top: `${(i / 8) * 100}%`,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: gridColor,
        }}
      />
    );
  }

  return <>{lines}</>;
};

// ── Component ──

const DeviceLinking: React.FC<DeviceLinkingProps> = ({
  devicePublicKey,
  deviceId,
  onApprove,
  onReject,
}) => {
  const isMobile = useIsMobile();
  const [fingerprint, setFingerprint] = useState<string>('');
  const [qrPayload, setQrPayload] = useState<string>('');
  const [scannedFingerprint, setScannedFingerprint] = useState<string>('');
  const [verificationError, setVerificationError] = useState<string | null>(null);

  useEffect(() => { injectKeyframes(); }, []);

  useEffect(() => {
    let cancelled = false;
    void generateFingerprint(devicePublicKey).then((fp) => {
      if (!cancelled) {
        setFingerprint(fp);
        // Build QR payload with timestamp to prevent replay attacks
        const payload = JSON.stringify({ fingerprint: fp, deviceId, timestamp: Date.now() });
        setQrPayload(payload);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [devicePublicKey, deviceId]);

  const formattedFingerprint = formatFingerprint(fingerprint);

  const handleApprove = useCallback(() => {
    const input = scannedFingerprint.trim();
    if (!input) return;

    // Try to parse as a QR payload (JSON with timestamp); fall back to raw fingerprint
    setVerificationError(null);
    try {
      const parsed = JSON.parse(input) as { fingerprint?: string; timestamp?: number };
      if (parsed.fingerprint && typeof parsed.timestamp === 'number') {
        const age = Date.now() - parsed.timestamp;
        if (age > QR_PAYLOAD_MAX_AGE_MS) {
          setVerificationError('QR code has expired (older than 5 minutes). Please scan a fresh code.');
          return;
        }
        onApprove(parsed.fingerprint);
        return;
      }
    } catch {
      // Not JSON — treat as a raw fingerprint string
    }

    onApprove(input);
  }, [scannedFingerprint, onApprove]);

  return (
    <div style={{
      ...styles.container,
      ...(isMobile ? { maxWidth: '100%', padding: 16 } : {}),
    }}>
      <h2 style={styles.heading}>Link a New Device</h2>

      {/* QR Code Section */}
      <div style={styles.section}>
        <h3 style={styles.subheading}>Your Device Fingerprint</h3>
        <p style={styles.description}>
          Scan this QR code from your other device, or compare the
          fingerprint text manually.
        </p>

        {/* QR Code placeholder with scanning grid and animated border */}
        <div style={{
          ...styles.qrOuterFrame,
          ...(isMobile ? { width: 160, height: 160 } : {}),
        }}>
          <QrCornerBrackets />
          <div style={{
            ...styles.qrPlaceholder,
            ...(isMobile ? { width: 140, height: 140 } : {}),
          }}>
            {/* Scanning grid pattern */}
            <ScanningGrid />
            {/* Animated scan line */}
            <div style={styles.qrScanLine} />
            <div style={styles.qrInner}>
              <span style={styles.qrLabel}>QR Code</span>
              <span style={styles.qrData}>
                {qrPayload ? qrPayload.slice(0, 24) + '...' : 'Generating...'}
              </span>
            </div>
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

        <div style={styles.scannerPlaceholder}>
          <svg width="32" height="32" viewBox="0 0 24 24" style={{ opacity: 0.4 }}>
            <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" stroke="#58a6ff" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <rect x="7" y="7" width="10" height="10" rx="1" stroke="#58a6ff" strokeWidth="1" fill="none" opacity="0.3" />
          </svg>
          <p style={styles.scannerText}>
            Camera QR scanning requires a native mobile app. Use manual
            fingerprint comparison below.
          </p>
        </div>

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

      {/* Verification error */}
      {verificationError && (
        <p style={{ margin: 0, fontSize: 13, color: '#f85149' }}>{verificationError}</p>
      )}

      {/* Actions */}
      <div style={{
        ...styles.actions,
        ...(isMobile ? { flexDirection: 'column' as const } : {}),
      }}>
        <button
          type="button"
          style={{
            ...styles.approveButton,
            ...(!scannedFingerprint.trim() ? styles.buttonDisabled : {}),
            minHeight: 44,
          }}
          onClick={handleApprove}
          disabled={!scannedFingerprint.trim()}
        >
          Approve Device
        </button>
        <button
          type="button"
          style={{ ...styles.rejectButton, minHeight: 44 }}
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
 * e.g. "abcd1234ef56" -> "abcd 1234 ef56"
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
    fontFamily: FONT_BODY,
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
  qrOuterFrame: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 200,
    height: 200,
    alignSelf: 'center',
    padding: 8,
  },
  qrPlaceholder: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 180,
    height: 180,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    overflow: 'hidden',
    animation: 'frameQrBorderRotate 4s linear infinite',
    border: '2px solid #58a6ff',
  },
  qrScanLine: {
    position: 'absolute' as const,
    left: 8,
    right: 8,
    height: 2,
    backgroundColor: 'rgba(88, 166, 255, 0.4)',
    borderRadius: 1,
    animation: 'frameQrScanLine 3s ease-in-out infinite',
    boxShadow: '0 0 8px rgba(88, 166, 255, 0.3)',
    zIndex: 1,
  },
  qrInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    zIndex: 2,
    position: 'relative' as const,
  },
  qrLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: '#333',
  },
  qrData: {
    fontSize: 10,
    color: '#666',
    fontFamily: FONT_MONO,
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
    fontFamily: FONT_MONO,
  },
  scannerPlaceholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: 24,
    backgroundColor: '#0d1117',
    border: '1px dashed #30363d',
    borderRadius: 8,
    animation: 'frameScannerPulse 3s ease-in-out infinite',
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
    padding: '10px 12px',
    fontSize: 14,
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 6,
    color: '#c9d1d9',
    outline: 'none',
    fontFamily: FONT_MONO,
    width: '100%',
    boxSizing: 'border-box' as const,
    minHeight: 44,
    transition: 'border-color 0.15s ease',
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
    transition: 'background-color 0.15s',
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
    transition: 'background-color 0.15s',
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
