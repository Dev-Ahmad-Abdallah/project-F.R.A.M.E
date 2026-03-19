/**
 * Key Change Alert modal for F.R.A.M.E.
 *
 * Shown when a contact's identity key changes. Displays old and new
 * fingerprints side-by-side and forces the user to choose an action
 * before the modal can be dismissed (fail-closed design).
 *
 * Visual polish: pulsing warning animation, visual diff highlighting
 * of changed fingerprint groups (Signal inspired).
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
import { useIsMobile } from '../hooks/useIsMobile';

// ── Keyframes (injected once) ──

const KEY_CHANGE_KEYFRAMES_ID = 'frame-key-change-alert-keyframes';

function injectKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEY_CHANGE_KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEY_CHANGE_KEYFRAMES_ID;
  style.textContent = `
    @keyframes frameKeyChangeEnter {
      0% { transform: scale(0.9); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes frameKeyChangeWarningPulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.08); }
    }
    @keyframes frameKeyChangeBorderPulse {
      0%, 100% { border-color: #f85149; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4); }
      50% { border-color: #ff8c82; box-shadow: 0 16px 48px rgba(248, 81, 73, 0.2); }
    }
    @keyframes frameKeyChangeDiffHighlight {
      0%, 100% { background-color: rgba(248, 81, 73, 0.1); }
      50% { background-color: rgba(248, 81, 73, 0.25); }
    }
    @keyframes frameKeyChangeGroupFadeIn {
      0% { opacity: 0; transform: translateY(4px); }
      100% { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

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

function getSafetyNumberGroups(hex: string): string[] {
  const digits = hex
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

// ── Fingerprint Diff Display ──

const FingerprintDiffDisplay: React.FC<{
  oldGroups: string[];
  newGroups: string[];
  label: string;
  groups: string[];
  color: string;
  isNew: boolean;
}> = ({ oldGroups, newGroups, label, groups, color, isNew }) => {
  return (
    <div style={styles.fingerprintColumn}>
      <p style={{ ...styles.fingerprintLabel, color }}>{label}</p>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap' as const,
        gap: '2px 6px',
        fontFamily: '"SF Mono", "Fira Code", monospace',
        fontSize: 12,
        lineHeight: 1.6,
      }}>
        {groups.map((group, i) => {
          // eslint-disable-next-line security/detect-object-injection
          const otherGroup = isNew ? oldGroups[i] : newGroups[i]; // Safe: i is from .map() index
          const isDifferent = otherGroup !== undefined && otherGroup !== group;

          return (
            <span
              key={i}
              style={{
                color: isDifferent ? (isNew ? '#3fb950' : '#f85149') : color,
                fontWeight: isDifferent ? 700 : 400,
                padding: '1px 4px',
                borderRadius: 3,
                backgroundColor: isDifferent
                  ? (isNew ? 'rgba(63, 185, 80, 0.15)' : 'rgba(248, 81, 73, 0.15)')
                  : 'transparent',
                animation: isDifferent
                  ? `frameKeyChangeDiffHighlight 1.5s ease-in-out infinite, frameKeyChangeGroupFadeIn 0.3s ease-out ${i * 0.03}s both`
                  : `frameKeyChangeGroupFadeIn 0.3s ease-out ${i * 0.03}s both`,
                textDecoration: isDifferent && !isNew ? 'line-through' : 'none',
              }}
            >
              {group}
            </span>
          );
        })}
      </div>
    </div>
  );
};

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
    padding: 16,
  },
  modal: {
    backgroundColor: '#161b22',
    border: '1px solid #f85149',
    borderRadius: 12,
    padding: 32,
    maxWidth: 520,
    width: '90%',
    animation: 'frameKeyChangeEnter 0.3s ease-out, frameKeyChangeBorderPulse 3s ease-in-out infinite',
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
    flexWrap: 'wrap' as const,
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
  diffLegend: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 20,
    fontSize: 11,
    color: '#8b949e',
  },
  diffLegendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
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
    transition: 'background-color 0.15s',
  },
  viewButton: {
    backgroundColor: '#58a6ff',
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
  const isMobile = useIsMobile();
  const [oldFingerprint, setOldFingerprint] = useState<string>('');
  const [newFingerprint, setNewFingerprint] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { injectKeyframes(); }, []);

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

    void compute();
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

  const oldGroups = getSafetyNumberGroups(oldFingerprint);
  const newGroups = getSafetyNumberGroups(newFingerprint);

  // Count differences for summary
  // eslint-disable-next-line security/detect-object-injection
  const diffCount = oldGroups.reduce((count, g, i) => count + (g !== newGroups[i] ? 1 : 0), 0); // Safe: i from reduce index

  return (
    <div style={{
      ...styles.overlay,
      ...(isMobile ? { padding: 0 } : {}),
    }} onClick={handleOverlayClick}>
      <div
        style={{
          ...styles.modal,
          ...(isMobile ? {
            maxWidth: '100%',
            width: '100%',
            height: '100%',
            borderRadius: 0,
            padding: '24px 16px',
            display: 'flex',
            flexDirection: 'column' as const,
            justifyContent: 'center',
          } : {}),
        }}
        role="alertdialog"
        aria-labelledby="key-change-title"
        aria-describedby="key-change-desc"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Warning header */}
        <div style={styles.warningIcon} aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{
            animation: 'frameKeyChangeWarningPulse 2s ease-in-out infinite',
          }}>
            <path d="M12 2L1 21h22L12 2z" stroke="#f85149" strokeWidth="1.5" fill="rgba(248,81,73,0.15)" />
            <path d="M12 9v4M12 16v.5" stroke="#f85149" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h2 id="key-change-title" style={styles.title}>Security Alert</h2>
        <p style={styles.subtitle}>{userId}</p>

        <p id="key-change-desc" style={styles.description}>
          The identity key for this contact has changed. This could mean
          they reinstalled the app, got a new device, or — in the worst
          case — someone is intercepting your communication. Verify their
          new fingerprint before continuing.
        </p>

        {/* Diff legend */}
        <div style={styles.diffLegend}>
          <div style={styles.diffLegendItem}>
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 2,
              backgroundColor: 'rgba(248, 81, 73, 0.3)',
              border: '1px solid #f85149',
            }} />
            <span>Changed ({diffCount} groups)</span>
          </div>
          <div style={styles.diffLegendItem}>
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 2,
              backgroundColor: '#21262d',
              border: '1px solid #30363d',
            }} />
            <span>Unchanged</span>
          </div>
        </div>

        {/* Side-by-side fingerprints with visual diff (stacked on mobile) */}
        <div style={{
          ...styles.fingerprintRow,
          ...(isMobile ? { flexDirection: 'column' as const, gap: 12 } : {}),
        }}>
          <FingerprintDiffDisplay
            oldGroups={oldGroups}
            newGroups={newGroups}
            label="Previous Key"
            groups={oldGroups}
            color="#f85149"
            isNew={false}
          />
          <FingerprintDiffDisplay
            oldGroups={oldGroups}
            newGroups={newGroups}
            label="New Key"
            groups={newGroups}
            color="#3fb950"
            isNew={true}
          />
        </div>

        {/* Actions — user MUST choose one */}
        <div style={{
          ...styles.actions,
          ...(isMobile ? { flexDirection: 'column' as const, gap: 10 } : {}),
        }}>
          <button
            type="button"
            style={{
              ...styles.buttonBase,
              ...styles.viewButton,
              ...(isMobile ? { width: '100%', minHeight: 48 } : {}),
            }}
            onClick={() => onAction('view-fingerprint')}
          >
            View Fingerprint
          </button>
          <button
            type="button"
            style={{
              ...styles.buttonBase,
              ...styles.acceptButton,
              ...(isMobile ? { width: '100%', minHeight: 48 } : {}),
            }}
            onClick={() => onAction('accept')}
          >
            Accept New Key
          </button>
          <button
            type="button"
            style={{
              ...styles.buttonBase,
              ...styles.blockButton,
              ...(isMobile ? { width: '100%', minHeight: 48 } : {}),
            }}
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
