/**
 * Fingerprint verification component for F.R.A.M.E.
 *
 * Displays a "safety number" derived from SHA-256 of the user's
 * public key, formatted as groups of 5 digits. Also shows a QR
 * code for in-person verification and a "Verify Contact" button.
 *
 * SECURITY: Never log or expose raw key material.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { generateFingerprint } from '../crypto/cryptoUtils';
import { useIsMobile } from '../hooks/useIsMobile';

// ── Types ──

export interface FingerprintUIProps {
  /** The contact's user ID (e.g. "@alice:frame.local") */
  userId: string;
  /** The contact's device ID */
  deviceId: string;
  /** The contact's public identity key (base64-encoded) */
  publicKey: string;
  /** Our own public identity key for comparison */
  ownPublicKey: string;
  /** Callback when contact is verified */
  onVerified?: (userId: string, deviceId: string) => void;
  /** Whether this contact has already been verified */
  isVerified?: boolean;
}

// ── Helpers ──

/**
 * Convert a hex fingerprint into groups of 5 digits for display
 * as a safety number. The hex string is converted to decimal digits,
 * then split into groups of 5, padded if needed.
 */
function formatSafetyNumber(hexFingerprint: string): string {
  // Convert hex to a numeric string of digits
  const digits = hexFingerprint
    .split('')
    .map((c) => parseInt(c, 16).toString())
    .join('')
    .slice(0, 60); // Take 60 digits (12 groups of 5)

  // Split into groups of 5
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 5) {
    groups.push(digits.slice(i, i + 5).padEnd(5, '0'));
  }

  return groups.join(' ');
}

// ── Styles ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#161b22',
    borderRadius: 8,
    border: '1px solid #30363d',
    maxWidth: 400,
  },
  title: {
    margin: '0 0 4px',
    fontSize: 16,
    fontWeight: 600,
    color: '#f0f6fc',
  },
  subtitle: {
    margin: '0 0 16px',
    fontSize: 13,
    color: '#8b949e',
  },
  safetyNumberLabel: {
    margin: '16px 0 8px',
    fontSize: 12,
    fontWeight: 600,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  safetyNumber: {
    fontFamily: '"SF Mono", "Fira Code", monospace',
    fontSize: 16,
    lineHeight: 1.6,
    color: '#c9d1d9',
    textAlign: 'center' as const,
    wordSpacing: 8,
    maxWidth: 320,
  },
  qrContainer: {
    margin: '20px 0',
    padding: 16,
    backgroundColor: '#ffffff',
    borderRadius: 8,
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 16,
  },
  verifiedBadge: {
    backgroundColor: 'rgba(35, 134, 54, 0.15)',
    color: '#3fb950',
    border: '1px solid rgba(35, 134, 54, 0.4)',
  },
  unverifiedBadge: {
    backgroundColor: 'rgba(187, 128, 9, 0.15)',
    color: '#d29922',
    border: '1px solid rgba(187, 128, 9, 0.4)',
  },
  verifyButton: {
    marginTop: 16,
    padding: '10px 24px',
    fontSize: 14,
    fontWeight: 500,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  verifyButtonDisabled: {
    opacity: 0.5,
    cursor: 'default',
  },
};

// ── Component ──

const FingerprintUI: React.FC<FingerprintUIProps> = ({
  userId,
  deviceId,
  publicKey,
  ownPublicKey,
  onVerified,
  isVerified = false,
}) => {
  const isMobile = useIsMobile();
  const [theirFingerprint, setTheirFingerprint] = useState<string>('');
  const [ourFingerprint, setOurFingerprint] = useState<string>('');
  const [verified, setVerified] = useState(isVerified);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function computeFingerprints() {
      const [theirs, ours] = await Promise.all([
        generateFingerprint(publicKey),
        generateFingerprint(ownPublicKey),
      ]);

      if (!cancelled) {
        setTheirFingerprint(theirs);
        setOurFingerprint(ours);
        setLoading(false);
      }
    }

    computeFingerprints();
    return () => { cancelled = true; };
  }, [publicKey, ownPublicKey]);

  const handleVerify = useCallback(() => {
    // Compare fingerprints — in a real flow the user would compare
    // the displayed safety numbers out-of-band (in person, voice call, etc.)
    // and then tap "Verify" to confirm they match.
    setVerified(true);
    onVerified?.(userId, deviceId);
  }, [userId, deviceId, onVerified]);

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={{ color: '#8b949e' }}>Computing fingerprints...</p>
      </div>
    );
  }

  // The QR code contains both fingerprints for cross-verification
  const qrPayload = JSON.stringify({
    userId,
    deviceId,
    fingerprint: theirFingerprint,
  });

  const theirSafetyNumber = formatSafetyNumber(theirFingerprint);
  const ourSafetyNumber = formatSafetyNumber(ourFingerprint);

  return (
    <div style={{
      ...styles.container,
      ...(isMobile ? { maxWidth: '100%', padding: 16 } : {}),
    }}>
      <h3 style={styles.title}>Verify Security</h3>
      <p style={styles.subtitle}>{userId}</p>

      {/* Verified / Unverified badge */}
      <div
        style={{
          ...styles.badge,
          ...(verified ? styles.verifiedBadge : styles.unverifiedBadge),
        }}
      >
        {verified ? 'Verified' : 'Unverified'}
      </div>

      {/* QR Code */}
      <div style={styles.qrContainer}>
        <QRCodeSVG value={qrPayload} size={isMobile ? 160 : 200} level="M" />
      </div>

      {/* Their safety number */}
      <p style={styles.safetyNumberLabel}>Their Safety Number</p>
      <p style={{
        ...styles.safetyNumber,
        ...(isMobile ? { fontSize: 14, maxWidth: '100%' } : {}),
      }}>{theirSafetyNumber}</p>

      {/* Our safety number */}
      <p style={styles.safetyNumberLabel}>Your Safety Number</p>
      <p style={{
        ...styles.safetyNumber,
        ...(isMobile ? { fontSize: 14, maxWidth: '100%' } : {}),
      }}>{ourSafetyNumber}</p>

      {/* Verify button */}
      {!verified && (
        <button
          type="button"
          style={{
            ...styles.verifyButton,
            ...(isMobile ? { width: '100%', minHeight: 48 } : {}),
          }}
          onClick={handleVerify}
        >
          Verify Contact
        </button>
      )}
    </div>
  );
};

export default FingerprintUI;
