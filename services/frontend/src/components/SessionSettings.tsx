/**
 * SessionSettings — Configurable session timeout and auto-lock panel.
 *
 * - "Session Timeout" dropdown: 5 min, 10 min, 30 min, 1 hour, 4 hours, Never
 * - "Auto-lock on inactivity" toggle — locks the app after the timeout
 * - Visual countdown timer showing remaining session time
 * - Custom styled timeout dropdown (Apple / 1Password inspired)
 * - Settings are stored in localStorage (not sensitive — just duration preferences)
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  SESSION_TIMEOUT_OPTIONS,
  getSavedTimeout,
  setSavedTimeout,
  getAutoLock,
  setAutoLock,
} from '../hooks/useSessionTimeout';
import { setSessionTimeout } from '../api/client';
import { useIsMobile } from '../hooks/useIsMobile';
import { isSoundEnabled, setSoundEnabled } from '../sounds';
import {
  getSendReadReceipts,
  setSendReadReceipts,
  getSendTypingIndicators,
  setSendTypingIndicators,
} from '../utils/privacyPreferences';

// ── Keyframes (injected once) ──

const SESSION_KEYFRAMES_ID = 'frame-session-settings-keyframes';

function injectKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SESSION_KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = SESSION_KEYFRAMES_ID;
  style.textContent = `
    @keyframes frameTimerPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    @keyframes frameTimerUrgentPulse {
      0%, 100% { opacity: 1; color: #f85149; }
      50% { opacity: 0.7; color: #ff6b6b; }
    }
    @keyframes frameTimerRingProgress {
      0% { stroke-dashoffset: 0; }
    }
    @keyframes frameDropdownFadeIn {
      0% { opacity: 0; transform: translateY(-4px); }
      100% { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ── Timer helpers ──

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface SessionSettingsProps {
  onActivateVault?: () => void;
}

const SessionSettings: React.FC<SessionSettingsProps> = ({ onActivateVault }) => {
  const isMobile = useIsMobile();
  const [timeoutMs, setTimeoutMs] = useState<number>(getSavedTimeout);
  const [autoLock, setAutoLockState] = useState<boolean>(getAutoLock);
  const [soundsOn, setSoundsOn] = useState<boolean>(isSoundEnabled);
  const [readReceipts, setReadReceiptsState] = useState<boolean>(getSendReadReceipts);
  const [typingIndicators, setTypingIndicatorsState] = useState<boolean>(getSendTypingIndicators);
  const [showDropdown, setShowDropdown] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number>(timeoutMs);
  const sessionStartRef = useRef<number>(Date.now());
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Vault mode state
  const [vaultEnabled, setVaultEnabled] = useState<boolean>(() =>
    localStorage.getItem('frame-vault-pin') !== null,
  );
  const [showPinInput, setShowPinInput] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => { injectKeyframes(); }, []);

  // Reset timer when timeout changes
  useEffect(() => {
    sessionStartRef.current = Date.now();
    setRemainingMs(timeoutMs);
  }, [timeoutMs]);

  // Countdown ticker
  useEffect(() => {
    if (timeoutMs === 0) return; // "Never" — no countdown
    const interval = setInterval(() => {
      const elapsed = Date.now() - sessionStartRef.current;
      const remaining = Math.max(0, timeoutMs - elapsed);
      setRemainingMs(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, [timeoutMs]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  const handleTimeoutChange = useCallback(
    (value: number) => {
      setTimeoutMs(value);
      setSavedTimeout(value);
      setSessionTimeout(value);
      setShowDropdown(false);
    },
    [],
  );

  const handleAutoLockToggle = useCallback(() => {
    setAutoLockState((prev) => {
      const next = !prev;
      setAutoLock(next);
      return next;
    });
  }, []);

  const handleSoundsToggle = useCallback(() => {
    setSoundsOn((prev) => {
      const next = !prev;
      setSoundEnabled(next);
      return next;
    });
  }, []);

  const handleReadReceiptsToggle = useCallback(() => {
    setReadReceiptsState((prev) => {
      const next = !prev;
      setSendReadReceipts(next);
      return next;
    });
  }, []);

  const handleTypingIndicatorsToggle = useCallback(() => {
    setTypingIndicatorsState((prev) => {
      const next = !prev;
      setSendTypingIndicators(next);
      return next;
    });
  }, []);

  const selectedLabel = SESSION_TIMEOUT_OPTIONS.find((o) => o.value === timeoutMs)?.label || 'Custom';
  const isNever = timeoutMs === 0;
  const progress = isNever ? 1 : remainingMs / timeoutMs;
  const isUrgent = !isNever && progress < 0.15;

  // SVG ring parameters — smaller on mobile
  const ringSize = isMobile ? 60 : 48;
  const ringRadius = isMobile ? 24 : 18;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - progress);

  return (
    <div style={{
      ...styles.container,
      ...(isMobile ? { maxWidth: '100%', padding: '16px 0' } : {}),
    }}>
      <h3 style={styles.heading}>Session Security</h3>

      {/* Visual countdown timer */}
      {!isNever && (
        <div style={{
          ...styles.timerContainer,
          ...(isMobile ? { flexDirection: 'column' as const, alignItems: 'center', textAlign: 'center' as const, padding: '16px 12px' } : {}),
        }}>
          <div style={{
            ...styles.timerRing,
            width: ringSize,
            height: ringSize,
          }}>
            <svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`}>
              {/* Background ring */}
              <circle
                cx={ringSize / 2} cy={ringSize / 2} r={ringRadius}
                fill="none"
                stroke="#21262d"
                strokeWidth="3"
              />
              {/* Progress ring */}
              <circle
                cx={ringSize / 2} cy={ringSize / 2} r={ringRadius}
                fill="none"
                stroke={isUrgent ? '#f85149' : '#238636'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                style={{
                  transform: 'rotate(-90deg)',
                  transformOrigin: '50% 50%',
                  transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease',
                }}
              />
            </svg>
            <span style={{
              ...styles.timerText,
              ...(isMobile ? { fontSize: 13 } : {}),
              ...(isUrgent ? { animation: 'frameTimerUrgentPulse 1s ease-in-out infinite' } : {}),
            }}>
              {formatCountdown(remainingMs)}
            </span>
          </div>
          <span style={{
            ...styles.timerLabel,
            color: isUrgent ? '#f85149' : '#8b949e',
          }}>
            {isUrgent ? 'Session expiring soon' : 'Session remaining'}
          </span>
        </div>
      )}

      {/* Session Timeout — custom dropdown */}
      <div style={{
        ...styles.row,
        ...(isMobile ? { flexDirection: 'column' as const, alignItems: 'stretch', gap: 8 } : {}),
      }}>
        <label htmlFor="session-timeout" style={styles.label}>
          Session Timeout
        </label>
        <div ref={dropdownRef} style={{
          ...styles.dropdownWrapper,
          ...(isMobile ? { width: '100%' } : {}),
        }}>
          <button
            type="button"
            id="session-timeout"
            style={{
              ...styles.customSelect,
              ...(isMobile ? { width: '100%', minHeight: 48, fontSize: 15, padding: '10px 14px', justifyContent: 'space-between' } : {}),
            }}
            onClick={() => setShowDropdown((p) => !p)}
            aria-haspopup="listbox"
            aria-expanded={showDropdown}
          >
            <span>{selectedLabel}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" style={{
              transform: showDropdown ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
            }}>
              <path d="M2 4l4 4 4-4" stroke="#8b949e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </button>
          {showDropdown && (
            <div style={{
              ...styles.dropdownMenu,
              ...(isMobile ? { left: 0, right: 0, minWidth: 'unset' } : {}),
            }} role="listbox">
              {SESSION_TIMEOUT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={opt.value === timeoutMs}
                  style={{
                    ...styles.dropdownItem,
                    ...(opt.value === timeoutMs ? styles.dropdownItemActive : {}),
                    ...(isMobile ? { minHeight: 44, fontSize: 15, padding: '10px 14px' } : {}),
                  }}
                  onClick={() => handleTimeoutChange(opt.value)}
                >
                  {opt.label}
                  {opt.value === timeoutMs && (
                    <svg width="14" height="14" viewBox="0 0 24 24" style={{ marginLeft: 'auto' }}>
                      <path d="M5 13l4 4L19 7" stroke="#3fb950" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <p style={styles.hint}>
        How long the app can remain idle before the session expires.
      </p>

      {/* Auto-lock toggle */}
      <div style={{
        ...styles.row,
        ...(isMobile ? { minHeight: 48, padding: '4px 0' } : {}),
      }}>
        <label htmlFor="auto-lock" style={styles.label}>
          Auto-lock on inactivity
        </label>
        <button
          id="auto-lock"
          type="button"
          role="switch"
          aria-checked={autoLock}
          onClick={handleAutoLockToggle}
          style={{
            ...styles.toggle,
            backgroundColor: autoLock ? '#238636' : '#30363d',
            ...(isMobile ? { width: 52, height: 30, borderRadius: 15 } : {}),
          }}
        >
          <span
            style={{
              ...styles.toggleKnob,
              ...(isMobile ? { width: 24, height: 24, top: 3 } : {}),
              transform: autoLock
                ? `translateX(${isMobile ? 22 : 18}px)`
                : `translateX(${isMobile ? 3 : 2}px)`,
            }}
          />
        </button>
      </div>

      <p style={styles.hint}>
        {autoLock
          ? 'The app will lock after inactivity and require your passphrase to unlock.'
          : 'The app will not lock automatically. Toggle on for added security.'}
      </p>

      {/* Notification Sounds toggle */}
      <div style={{
        ...styles.row,
        ...(isMobile ? { minHeight: 48, padding: '4px 0' } : {}),
      }}>
        <label htmlFor="notification-sounds" style={styles.label}>
          {soundsOn ? '\uD83D\uDD0A Sound Effects' : '\uD83D\uDD07 Silent Ops'}
        </label>
        <button
          id="notification-sounds"
          type="button"
          role="switch"
          aria-checked={soundsOn}
          onClick={handleSoundsToggle}
          style={{
            ...styles.toggle,
            backgroundColor: soundsOn ? '#238636' : '#30363d',
            ...(isMobile ? { width: 52, height: 30, borderRadius: 15 } : {}),
          }}
        >
          <span
            style={{
              ...styles.toggleKnob,
              ...(isMobile ? { width: 24, height: 24, top: 3 } : {}),
              transform: soundsOn
                ? `translateX(${isMobile ? 22 : 18}px)`
                : `translateX(${isMobile ? 3 : 2}px)`,
            }}
          />
        </button>
      </div>

      <p style={styles.hint}>
        {soundsOn
          ? 'Tactical audio feedback for sends, receives, destructs, and joins.'
          : 'Silent Ops — all sound effects are suppressed.'}
      </p>

      {/* ── Privacy section ── */}
      <h3 style={{ ...styles.heading, marginTop: 8 }}>Privacy</h3>

      {/* Send Read Receipts toggle */}
      <div style={{
        ...styles.row,
        ...(isMobile ? { minHeight: 48, padding: '4px 0' } : {}),
      }}>
        <label htmlFor="send-read-receipts" style={styles.label}>
          Send Read Receipts
        </label>
        <button
          id="send-read-receipts"
          type="button"
          role="switch"
          aria-checked={readReceipts}
          onClick={handleReadReceiptsToggle}
          style={{
            ...styles.toggle,
            backgroundColor: readReceipts ? '#238636' : '#30363d',
            ...(isMobile ? { width: 52, height: 30, borderRadius: 15 } : {}),
          }}
        >
          <span
            style={{
              ...styles.toggleKnob,
              ...(isMobile ? { width: 24, height: 24, top: 3 } : {}),
              transform: readReceipts
                ? `translateX(${isMobile ? 22 : 18}px)`
                : `translateX(${isMobile ? 3 : 2}px)`,
            }}
          />
        </button>
      </div>

      <p style={styles.hint}>
        {readReceipts
          ? 'Other users can see when you have read their messages.'
          : 'Read receipts are disabled. Other users will not know when you read their messages.'}
      </p>

      {/* Send Typing Indicators toggle */}
      <div style={{
        ...styles.row,
        ...(isMobile ? { minHeight: 48, padding: '4px 0' } : {}),
      }}>
        <label htmlFor="send-typing-indicators" style={styles.label}>
          Send Typing Indicators
        </label>
        <button
          id="send-typing-indicators"
          type="button"
          role="switch"
          aria-checked={typingIndicators}
          onClick={handleTypingIndicatorsToggle}
          style={{
            ...styles.toggle,
            backgroundColor: typingIndicators ? '#238636' : '#30363d',
            ...(isMobile ? { width: 52, height: 30, borderRadius: 15 } : {}),
          }}
        >
          <span
            style={{
              ...styles.toggleKnob,
              ...(isMobile ? { width: 24, height: 24, top: 3 } : {}),
              transform: typingIndicators
                ? `translateX(${isMobile ? 22 : 18}px)`
                : `translateX(${isMobile ? 3 : 2}px)`,
            }}
          />
        </button>
      </div>

      <p style={styles.hint}>
        {typingIndicators
          ? 'Other users can see when you are typing a message.'
          : 'Typing indicators are disabled. Other users will not see when you are typing.'}
      </p>

      {/* ── Vault Mode section ── */}
      <h3 style={{ ...styles.heading, marginTop: 8 }}>Vault Mode</h3>

      {/* Vault Mode toggle */}
      <div style={{
        ...styles.row,
        ...(isMobile ? { minHeight: 48, padding: '4px 0' } : {}),
      }}>
        <label htmlFor="vault-mode" style={styles.label}>
          <span style={{ marginRight: 6 }}>{'\uD83D\uDD12'}</span>
          Vault Mode
        </label>
        <button
          id="vault-mode"
          type="button"
          role="switch"
          aria-checked={vaultEnabled}
          onClick={() => {
            if (vaultEnabled) {
              // Disable vault mode
              localStorage.removeItem('frame-vault-pin');
              localStorage.removeItem('frame-vault-active');
              setVaultEnabled(false);
              setShowPinInput(false);
              setPinValue('');
            } else {
              // Show PIN input to enable
              setShowPinInput(true);
              setPinError(null);
              setPinValue('');
            }
          }}
          style={{
            ...styles.toggle,
            backgroundColor: vaultEnabled ? '#238636' : '#30363d',
            ...(isMobile ? { width: 52, height: 30, borderRadius: 15 } : {}),
          }}
        >
          <span
            style={{
              ...styles.toggleKnob,
              ...(isMobile ? { width: 24, height: 24, top: 3 } : {}),
              transform: vaultEnabled
                ? `translateX(${isMobile ? 22 : 18}px)`
                : `translateX(${isMobile ? 3 : 2}px)`,
            }}
          />
        </button>
      </div>

      <p style={styles.hint}>
        {vaultEnabled
          ? 'Vault Mode is enabled. The app disguises itself as a calculator. Enter your PIN + "=" to unlock.'
          : 'Disguise the app as a calculator. Triple-tap the logo or toggle from settings to activate.'}
      </p>

      {/* PIN setup input */}
      {showPinInput && !vaultEnabled && (
        <div style={{
          padding: '12px 14px',
          backgroundColor: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 8,
          marginBottom: 12,
        }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#8b949e', display: 'block', marginBottom: 8 }}>
            Set a 4-digit PIN to unlock the app from the calculator
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pinValue}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9]/g, '');
                setPinValue(val);
                setPinError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (pinValue.length < 4) {
                    setPinError('PIN must be at least 4 digits');
                  } else {
                    localStorage.setItem('frame-vault-pin', pinValue);
                    setVaultEnabled(true);
                    setShowPinInput(false);
                    setPinValue('');
                    setPinError(null);
                  }
                }
              }}
              placeholder="Enter PIN (min 4 digits)"
              autoFocus
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: 14,
                borderRadius: 6,
                border: '1px solid #30363d',
                backgroundColor: '#161b22',
                color: '#c9d1d9',
                fontFamily: '"SF Mono", "Fira Code", monospace',
                letterSpacing: '0.2em',
                outline: 'none',
                textAlign: 'center' as const,
                ...(isMobile ? { minHeight: 44, fontSize: 16 } : {}),
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (pinValue.length < 4) {
                  setPinError('PIN must be at least 4 digits');
                  return;
                }
                localStorage.setItem('frame-vault-pin', pinValue);
                setVaultEnabled(true);
                setShowPinInput(false);
                setPinValue('');
                setPinError(null);
              }}
              style={{
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: 600,
                backgroundColor: '#238636',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: 'inherit',
                ...(isMobile ? { minHeight: 44, fontSize: 14 } : {}),
              }}
            >
              Set
            </button>
            <button
              type="button"
              onClick={() => { setShowPinInput(false); setPinValue(''); setPinError(null); }}
              style={{
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 500,
                backgroundColor: 'transparent',
                color: '#8b949e',
                border: '1px solid #30363d',
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: 'inherit',
                ...(isMobile ? { minHeight: 44, fontSize: 14 } : {}),
              }}
            >
              Cancel
            </button>
          </div>
          {pinError && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#f85149' }}>{pinError}</div>
          )}
        </div>
      )}

      {/* Quick-activate button when vault is enabled */}
      {vaultEnabled && onActivateVault && (
        <button
          type="button"
          onClick={onActivateVault}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            padding: '10px 16px',
            fontSize: 13,
            fontWeight: 600,
            backgroundColor: 'rgba(88, 166, 255, 0.08)',
            color: '#58a6ff',
            border: '1px solid rgba(88, 166, 255, 0.2)',
            borderRadius: 8,
            cursor: 'pointer',
            fontFamily: 'inherit',
            marginBottom: 8,
            ...(isMobile ? { minHeight: 48, fontSize: 14 } : {}),
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="3" y="8" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
            <path d="M5.5 8V5.5a2.5 2.5 0 015 0V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Activate Vault Mode Now
        </button>
      )}
    </div>
  );
};

// ── Styles (dark theme) ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    maxWidth: 440,
    padding: '20px 0',
  },
  heading: {
    margin: '0 0 16px',
    fontSize: 16,
    fontWeight: 600,
    color: '#e6edf3',
  },
  timerContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 16px',
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 8,
    marginBottom: 16,
  },
  timerRing: {
    position: 'relative' as const,
    width: 48,
    height: 48,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  timerText: {
    position: 'absolute' as const,
    fontSize: 11,
    fontWeight: 600,
    color: '#e6edf3',
    fontFamily: '"SF Mono", "Fira Code", monospace',
  },
  timerLabel: {
    fontSize: 13,
    color: '#8b949e',
    fontWeight: 500,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  label: {
    fontSize: 14,
    color: '#c9d1d9',
  },
  dropdownWrapper: {
    position: 'relative' as const,
  },
  customSelect: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 12px',
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 6,
    border: '1px solid #30363d',
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'border-color 0.15s ease',
    minWidth: 120,
  },
  dropdownMenu: {
    position: 'absolute' as const,
    top: 'calc(100% + 4px)',
    right: 0,
    minWidth: 160,
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    padding: 4,
    zIndex: 100,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
    animation: 'frameDropdownFadeIn 0.15s ease-out',
  },
  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '8px 12px',
    fontSize: 13,
    color: '#c9d1d9',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left' as const,
    transition: 'background-color 0.1s',
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(35, 134, 54, 0.15)',
    color: '#3fb950',
  },
  hint: {
    margin: '2px 0 16px',
    fontSize: 12,
    color: '#9ea7b3',
    lineHeight: 1.4,
  },
  toggle: {
    position: 'relative',
    width: 40,
    height: 22,
    borderRadius: 11,
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    transition: 'background-color 0.2s',
    flexShrink: 0,
  },
  toggleKnob: {
    display: 'block',
    width: 18,
    height: 18,
    borderRadius: '50%',
    backgroundColor: '#ffffff',
    transition: 'transform 0.2s',
    position: 'absolute',
    top: 2,
    left: 0,
  },
};

export default SessionSettings;
