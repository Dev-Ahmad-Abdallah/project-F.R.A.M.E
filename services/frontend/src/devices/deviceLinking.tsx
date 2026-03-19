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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
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
    @keyframes frameScanSuccess {
      0% { transform: scale(0); opacity: 0; }
      50% { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes frameScanSuccessFade {
      0% { opacity: 1; }
      70% { opacity: 1; }
      100% { opacity: 0; }
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

  // Camera / scanner state
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { injectKeyframes(); }, []);

  useEffect(() => {
    let cancelled = false;
    void generateFingerprint(devicePublicKey).then((fp) => {
      if (!cancelled) {
        setFingerprint(fp);
        const payload = JSON.stringify({ fingerprint: fp, deviceId, timestamp: Date.now() });
        setQrPayload(payload);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [devicePublicKey, deviceId]);

  // Stop camera helper
  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Handle a successfully detected QR payload
  const handleQrDetected = useCallback((rawValue: string) => {
    // Stop scanning immediately
    stopCamera();

    // Show success animation
    setScanSuccess(true);

    // Try to parse the JSON payload to extract fingerprint for display
    let displayValue = rawValue;
    try {
      const parsed = JSON.parse(rawValue) as { fingerprint?: string };
      if (parsed.fingerprint) {
        displayValue = rawValue; // Keep the full JSON so handleApprove can validate timestamp
      }
    } catch {
      // Raw string — use as-is
    }

    setScannedFingerprint(displayValue);

    // Clear success animation after 1.5s
    setTimeout(() => {
      setScanSuccess(false);
      setScannerOpen(false);
    }, 1500);
  }, [stopCamera]);

  // Start camera and begin scanning
  const openScanner = useCallback(async () => {
    setCameraError(null);
    setScannerOpen(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;

      // Wait for video element to be mounted
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Check if BarcodeDetector is available
      const hasBarcodeDetector =
        typeof window !== 'undefined' && 'BarcodeDetector' in window;

      if (hasBarcodeDetector) {
        // Use BarcodeDetector API
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({
          formats: ['qr_code'],
        });

        scanIntervalRef.current = setInterval(() => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          const detectPromise = detector.detect(videoRef.current);
          void (detectPromise as Promise<Array<{ rawValue: string }>>).then((barcodes: Array<{ rawValue: string }>) => {
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              handleQrDetected(barcodes[0].rawValue);
            }
          }).catch(() => { /* Detection frame failed — continue scanning */ });
        }, 500);
      } else {
        // No BarcodeDetector — show fallback message after a moment.
        // We still keep the camera open so the user sees it's working,
        // but inform them to use manual entry.
        setCameraError(
          'Your browser does not support QR code detection. Please enter the fingerprint manually below.'
        );
      }
    } catch (rawErr: unknown) {
      // Camera access denied or not available
      const err = rawErr instanceof Error ? rawErr : null;
      const message =
        err?.name === 'NotAllowedError'
          ? 'Camera access denied. You can enter the fingerprint manually below.'
          : err?.name === 'NotFoundError'
            ? 'No camera found on this device. You can enter the fingerprint manually below.'
            : 'Could not access camera. You can enter the fingerprint manually below.';
      setCameraError(message);
      setScannerOpen(false);
    }
  }, [handleQrDetected]);

  const closeScanner = useCallback(() => {
    stopCamera();
    setScannerOpen(false);
    setCameraError(null);
  }, [stopCamera]);

  const formattedFingerprint = formatFingerprint(fingerprint);

  const handleApprove = useCallback(() => {
    const input = scannedFingerprint.trim();
    if (!input) return;

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

        {/* QR Code with animated border */}
        <div style={{
          ...styles.qrOuterFrame,
          ...(isMobile ? { width: 160, height: 160 } : {}),
        }}>
          <QrCornerBrackets />
          <div style={{
            ...styles.qrPlaceholder,
            ...(isMobile ? { width: 140, height: 140 } : {}),
          }}>
            {qrPayload ? (
              <QRCodeSVG value={qrPayload} size={isMobile ? 120 : 160} bgColor="#ffffff" fgColor="#000000" />
            ) : (
              <div style={styles.qrInner}>
                <span style={styles.qrLabel}>Generating...</span>
              </div>
            )}
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

        {!scannerOpen && !scanSuccess && (
          <div style={styles.scannerPlaceholder}>
            <svg width="32" height="32" viewBox="0 0 24 24" style={{ opacity: 0.4 }}>
              <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" stroke="#58a6ff" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <rect x="7" y="7" width="10" height="10" rx="1" stroke="#58a6ff" strokeWidth="1" fill="none" opacity="0.3" />
            </svg>
            <button
              type="button"
              style={styles.openCameraButton}
              onClick={() => void openScanner()}
            >
              Open Camera Scanner
            </button>
            <p style={styles.scannerText}>
              Point your camera at the other device&apos;s QR code to link automatically.
            </p>
          </div>
        )}

        {/* Camera error message */}
        {cameraError && (
          <p style={styles.cameraErrorText}>
            {DOMPurify.sanitize(cameraError, PURIFY_CONFIG)}
          </p>
        )}

        {/* Live camera feed */}
        {scannerOpen && (
          <div style={styles.cameraContainer}>
            <div style={styles.cameraViewport}>
              <QrCornerBrackets />
              <video
                ref={videoRef}
                style={styles.cameraVideo}
                playsInline
                muted
              />
              {/* Scan line overlay */}
              <div style={styles.qrScanLine} />
              <ScanningGrid />

              {/* Success overlay */}
              {scanSuccess && (
                <div style={styles.successOverlay}>
                  <svg
                    width="64"
                    height="64"
                    viewBox="0 0 64 64"
                    style={{
                      animation: 'frameScanSuccess 0.4s ease-out forwards',
                    }}
                  >
                    <circle cx="32" cy="32" r="30" fill="#238636" opacity="0.9" />
                    <path
                      d="M20 32 L28 40 L44 24"
                      stroke="#ffffff"
                      strokeWidth="4"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <p style={{ color: '#3fb950', fontSize: 14, fontWeight: 600, margin: '8px 0 0' }}>
                    QR Code Scanned!
                  </p>
                </div>
              )}
            </div>

            <button
              type="button"
              style={styles.closeCameraButton}
              onClick={closeScanner}
            >
              Close Camera
            </button>
          </div>
        )}

        {/* Hidden canvas for frame capture (used by BarcodeDetector fallback if needed) */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />

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
        <p style={{ margin: 0, fontSize: 13, color: '#f85149' }}>{DOMPurify.sanitize(verificationError, PURIFY_CONFIG)}</p>
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
  openCameraButton: {
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#21262d',
    color: '#58a6ff',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'background-color 0.15s, border-color 0.15s',
    minHeight: 44,
  },
  cameraContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 12,
  },
  cameraViewport: {
    position: 'relative' as const,
    width: '100%',
    maxWidth: 320,
    aspectRatio: '1 / 1',
    backgroundColor: '#0d1117',
    borderRadius: 12,
    overflow: 'hidden',
    border: '2px solid #30363d',
  },
  cameraVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
    borderRadius: 10,
  },
  successOverlay: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(13, 17, 23, 0.85)',
    zIndex: 10,
    animation: 'frameScanSuccessFade 1.5s ease-in-out forwards',
  },
  closeCameraButton: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 500,
    backgroundColor: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
  },
  cameraErrorText: {
    margin: 0,
    fontSize: 13,
    color: '#d29922',
    padding: '8px 12px',
    backgroundColor: 'rgba(210, 153, 34, 0.1)',
    border: '1px solid rgba(210, 153, 34, 0.2)',
    borderRadius: 6,
    lineHeight: 1.5,
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
