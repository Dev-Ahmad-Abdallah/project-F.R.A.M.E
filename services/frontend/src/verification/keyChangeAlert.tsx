/**
 * Key Change Alert modal for F.R.A.M.E.
 *
 * Shown when a contact's identity key changes. Displays old and new
 * fingerprints side-by-side and forces the user to choose an action
 * before the modal can be dismissed (fail-closed design).
 *
 * Actions:
 *   - "View Fingerprint" — navigate to the fingerprint verification screen
 *   - "Accept New Key"   — trust the new key and continue
 *   - "Block"            — block the contact
 *
 * SECURITY: Never log raw key material. The modal cannot be dismissed
 * without an explicit user action.
 */

import React, { useState, useEffect } from 'react';
import { generateFingerprint } from '../crypto/cryptoUtils';

// ── Types ──

export type KeyChangeAction = 'view-fingerprint' | 'accept' | 'block';

export interface KeyChangeAlertProps {
  /** The contact whose key changed */
  userId: string;
  /** The previous (old) public identity key */
  oldPublicKey: string;
  /** The new public identity key */
  newPublicKey: string;
  /** Callback when the user selects an action */
  onAction: (action: KeyChangeAction) => void;
}

// ── Helpers ──

function formatFingerprint(hex: string): string {
  const digits = hex
    .split('')
    .map((c) => parseInt(c, 16).toString())
    .join('')
    .slice(0, 60);

  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 5) {
    groups.push(digits.slice(i, i + 5).padEnd(5, '0'));
  }
  return groups.join(' ');
}

// ── Styles ──

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    backgroundColor: '#161b22',
    border: '1px solid #f85149',
    borderRadius: 12,
    padding: 32,
    maxWidth: 520,
    width: '90%',
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
  },
  warningIcon: {
    fontSize: 32,
    textAlign: 'center' as const,
    marginBottom: 8,
    color: '#f85149',
  },
  title: {
    margin: '0 0 4px',
    fontSize: 18,
    fontWeight: 600,
    color: '#f85149',
    textAlign: 'center' as const,
  },
  subtitle: {
    margin: '0 0 24px',
    fontSize: 14,
    color: '#8b949e',
    textAlign: 'center' as const,
  },
  description: {
    margin: '0 0 24px',
    fontSize: 14,
    lineHeight: 1.5,
    color: '#c9d1d9',
  },
  fingerprintRow: {
    display: 'flex',
    gap: 16,
    marginBottom: 24,
  },
  fingerprintColumn: {
    flex: 1,
    padding: 12,
    backgroundColor: '#0d1117',
    borderRadius: 8,
    border: '1px solid #30363d',
  },
  fingerprintLabel: {
    margin: '0 0 8px',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    color: '#8b949e',
  },
  fingerprintValue: {
    fontFamily: '"SF Mono", "Fira Code", monospace',
    fontSize: 12,
    lineHeight: 1.5,
    color: '#c9d1d9',
    wordSpacing: 4,
    wordBreak: 'break-all' as const,
  },
  oldKey: {
    color: '#f85149',
  },
  newKey: {
    color: '#3fb950',
  },
  actions: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    flexWrap: 'wrap' as const,
  },
  buttonBase: {
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 500,
    borderRadius: 6,
    cursor: 'pointer',
    border: 'none',
    minWidth: 130,
  },
  viewButton: {
    backgroundColor: '#1f6feb',
    color: '#ffffff',
  },
  acceptButton: {
    backgroundColor: '#238636',
    color: '#ffffff',
  },
  blockButton: {
    backgroundColor: '#da3633',
    color: '#ffffff',
  },
};

// ── Component ──

const KeyChangeAlert: React.FC<KeyChangeAlertProps> = ({
  userId,
  oldPublicKey,
  newPublicKey,
  onAction,
}) => {
  const [oldFingerprint, setOldFingerprint] = useState<string>('');
  const [newFingerprint, setNewFingerprint] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function compute() {
      const [oldFp, newFp] = await Promise.all([
        generateFingerprint(oldPublicKey),
        generateFingerprint(newPublicKey),
      ]);

      if (!cancelled) {
        setOldFingerprint(oldFp);
        setNewFingerprint(newFp);
        setLoading(false);
      }
    }

    compute();
    return () => { cancelled = true; };
  }, [oldPublicKey, newPublicKey]);

  // Prevent background scrolling while modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = originalOverflow; };
  }, []);

  // Block Escape key and overlay clicks — fail-closed: user MUST choose an action
  const handleOverlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Do nothing — cannot dismiss without choosing an action
  };

  if (loading) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <p style={{ color: '#8b949e', textAlign: 'center' }}>
            Computing fingerprints...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay} onClick={handleOverlayClick}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Warning header */}
        <div style={styles.warningIcon}>!!</div>
        <h2 style={styles.title}>Security Alert</h2>
        <p style={styles.subtitle}>{userId}</p>

        <p style={styles.description}>
          The identity key for this contact has changed. This could mean
          they reinstalled the app, got a new device, or — in the worst
          case — someone is intercepting your communication. Verify their
          new fingerprint before continuing.
        </p>

        {/* Side-by-side fingerprints */}
        <div style={styles.fingerprintRow}>
          <div style={styles.fingerprintColumn}>
            <p style={{ ...styles.fingerprintLabel, ...styles.oldKey }}>
              Previous Key
            </p>
            <p style={{ ...styles.fingerprintValue, ...styles.oldKey }}>
              {formatFingerprint(oldFingerprint)}
            </p>
          </div>
          <div style={styles.fingerprintColumn}>
            <p style={{ ...styles.fingerprintLabel, ...styles.newKey }}>
              New Key
            </p>
            <p style={{ ...styles.fingerprintValue, ...styles.newKey }}>
              {formatFingerprint(newFingerprint)}
            </p>
          </div>
        </div>

        {/* Actions — user MUST choose one */}
        <div style={styles.actions}>
          <button
            type="button"
            style={{ ...styles.buttonBase, ...styles.viewButton }}
            onClick={() => onAction('view-fingerprint')}
          >
            View Fingerprint
          </button>
          <button
            type="button"
            style={{ ...styles.buttonBase, ...styles.acceptButton }}
            onClick={() => onAction('accept')}
          >
            Accept New Key
          </button>
          <button
            type="button"
            style={{ ...styles.buttonBase, ...styles.blockButton }}
            onClick={() => onAction('block')}
          >
            Block
          </button>
        </div>
      </div>
    </div>
  );
};

export default KeyChangeAlert;
