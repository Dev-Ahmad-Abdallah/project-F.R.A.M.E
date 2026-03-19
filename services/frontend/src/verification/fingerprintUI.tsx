/**
 * Fingerprint verification component for F.R.A.M.E.
 *
 * Displays a "safety number" derived from SHA-256 of the user's
 * public key, formatted as groups of 5 digits. Also shows a QR
 * code for in-person verification and a "Verify Contact" button.
 *
 * Visual polish: alternating color groups for safety numbers,
 * "Copy" button with checkmark animation (Signal inspired).
 *
 * SECURITY: Never log or expose raw key material.
 */

import React, { useState, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
import { QRCodeSVG } from 'qrcode.react';
import { generateFingerprint } from '../crypto/cryptoUtils';
import { useIsMobile } from '../hooks/useIsMobile';

// ── Keyframes (injected once) ──

const FINGERPRINT_KEYFRAMES_ID = 'frame-fingerprint-ui-keyframes';

function injectKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FINGERPRINT_KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = FINGERPRINT_KEYFRAMES_ID;
  style.textContent = `
    @keyframes frameCopyCheckIn {
      0% { transform: scale(0); opacity: 0; }
      50% { transform: scale(1.3); }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes frameCopyFadeOut {
      0% { opacity: 1; }
      80% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes frameSafetyNumberFadeIn {
      0% { opacity: 0; transform: translateY(4px); }
      100% { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

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

function getSafetyNumberGroups(hexFingerprint: string): string[] {
  const digits = hexFingerprint
    .split('')
    .map((c) => parseInt(c, 16).toString())
    .join('')
    .slice(0, 60);

  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 5) {
    groups.push(digits.slice(i, i + 5).padEnd(5, '0'));
  }
  return groups;
}

// Alternating colors for safety number groups (Signal-style readability)
const GROUP_COLORS = ['#58a6ff', '#c9d1d9'];

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
  safetyNumberContainer: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
    gap: '4px 10px',
    maxWidth: 320,
    fontFamily: '"SF Mono", "Fira Code", monospace',
    fontSize: 16,
    lineHeight: 1.8,
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
  copyButtonRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  copyButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 500,
    backgroundColor: '#21262d',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s, color 0.15s',
  },
  copiedText: {
    fontSize: 12,
    fontWeight: 500,
    color: '#3fb950',
    animation: 'frameCopyFadeOut 2s ease-out forwards',
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
    transition: 'background-color 0.15s',
  },
  verifyButtonDisabled: {
    opacity: 0.5,
    cursor: 'default',
  },
};

// ── SafetyNumberDisplay — colored groups sub-component ──

const SafetyNumberDisplay: React.FC<{
  hexFingerprint: string;
  isMobile: boolean;
  label: string;
  onCopy?: () => void;
  copied?: boolean;
}> = ({ hexFingerprint, isMobile, label, onCopy, copied }) => {
  const groups = getSafetyNumberGroups(hexFingerprint);

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <p style={styles.safetyNumberLabel}>{label}</p>
      <div style={{
        ...styles.safetyNumberContainer,
        ...(isMobile ? { fontSize: 14, maxWidth: '100%' } : {}),
      }}>
        {groups.map((group, i) => (
          <span
            key={i}
            style={{
              color: GROUP_COLORS[i % 2],
              fontWeight: i % 2 === 0 ? 600 : 400,
              padding: '2px 4px',
              borderRadius: 3,
              backgroundColor: i % 2 === 0 ? 'rgba(88, 166, 255, 0.06)' : 'transparent',
              animation: `frameSafetyNumberFadeIn 0.3s ease-out ${i * 0.03}s both`,
            }}
          >
            {group}
          </span>
        ))}
      </div>
      {onCopy && (
        <div style={styles.copyButtonRow}>
          <button
            type="button"
            style={styles.copyButton}
            onClick={onCopy}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" style={{ animation: 'frameCopyCheckIn 0.3s ease-out' }}>
                <path d="M5 13l4 4L19 7" stroke="#3fb950" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24">
                <rect x="9" y="9" width="13" height="13" rx="2" stroke="#8b949e" strokeWidth="1.5" fill="none" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="#8b949e" strokeWidth="1.5" fill="none" />
              </svg>
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  );
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
  const [copiedTheirs, setCopiedTheirs] = useState(false);
  const [copiedOurs, setCopiedOurs] = useState(false);

  useEffect(() => { injectKeyframes(); }, []);

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

    void computeFingerprints();
    return () => { cancelled = true; };
  }, [publicKey, ownPublicKey]);

  const handleVerify = useCallback(() => {
    setVerified(true);
    onVerified?.(userId, deviceId);
  }, [userId, deviceId, onVerified]);

  const handleCopyTheirs = useCallback(() => {
    const text = formatSafetyNumber(theirFingerprint);
    void navigator.clipboard.writeText(text);
    setCopiedTheirs(true);
    setTimeout(() => setCopiedTheirs(false), 2000);
  }, [theirFingerprint]);

  const handleCopyOurs = useCallback(() => {
    const text = formatSafetyNumber(ourFingerprint);
    void navigator.clipboard.writeText(text);
    setCopiedOurs(true);
    setTimeout(() => setCopiedOurs(false), 2000);
  }, [ourFingerprint]);

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

  return (
    <div style={{
      ...styles.container,
      ...(isMobile ? { maxWidth: '100%', padding: 16 } : {}),
    }}>
      <h3 style={styles.title}>Verify Security</h3>
      <p style={styles.subtitle}>{DOMPurify.sanitize(userId, PURIFY_CONFIG)}</p>

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

      {/* Their safety number — with colored groups and copy */}
      <SafetyNumberDisplay
        hexFingerprint={theirFingerprint}
        isMobile={isMobile}
        label="Their Safety Number"
        onCopy={handleCopyTheirs}
        copied={copiedTheirs}
      />

      {/* Our safety number — with colored groups and copy */}
      <SafetyNumberDisplay
        hexFingerprint={ourFingerprint}
        isMobile={isMobile}
        label="Your Safety Number"
        onCopy={handleCopyOurs}
        copied={copiedOurs}
      />

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
