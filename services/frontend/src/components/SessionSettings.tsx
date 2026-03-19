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

const SessionSettings: React.FC = () => {
  const [timeoutMs, setTimeoutMs] = useState<number>(getSavedTimeout);
  const [autoLock, setAutoLockState] = useState<boolean>(getAutoLock);
  const [showDropdown, setShowDropdown] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number>(timeoutMs);
  const sessionStartRef = useRef<number>(Date.now());
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const selectedLabel = SESSION_TIMEOUT_OPTIONS.find((o) => o.value === timeoutMs)?.label || 'Custom';
  const isNever = timeoutMs === 0;
  const progress = isNever ? 1 : remainingMs / timeoutMs;
  const isUrgent = !isNever && progress < 0.15;

  // SVG ring parameters
  const ringRadius = 18;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - progress);

  return (
    <div style={styles.container}>
      <h3 style={styles.heading}>Session Security</h3>

      {/* Visual countdown timer */}
      {!isNever && (
        <div style={styles.timerContainer}>
          <div style={styles.timerRing}>
            <svg width="48" height="48" viewBox="0 0 48 48">
              {/* Background ring */}
              <circle
                cx="24" cy="24" r={ringRadius}
                fill="none"
                stroke="#21262d"
                strokeWidth="3"
              />
              {/* Progress ring */}
              <circle
                cx="24" cy="24" r={ringRadius}
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
      <div style={styles.row}>
        <label htmlFor="session-timeout" style={styles.label}>
          Session Timeout
        </label>
        <div ref={dropdownRef} style={styles.dropdownWrapper}>
          <button
            type="button"
            id="session-timeout"
            style={styles.customSelect}
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
            <div style={styles.dropdownMenu} role="listbox">
              {SESSION_TIMEOUT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={opt.value === timeoutMs}
                  style={{
                    ...styles.dropdownItem,
                    ...(opt.value === timeoutMs ? styles.dropdownItemActive : {}),
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
      <div style={styles.row}>
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
          }}
        >
          <span
            style={{
              ...styles.toggleKnob,
              transform: autoLock ? 'translateX(18px)' : 'translateX(2px)',
            }}
          />
        </button>
      </div>

      <p style={styles.hint}>
        {autoLock
          ? 'The app will lock after inactivity and require your passphrase to unlock.'
          : 'The app will not lock automatically. Toggle on for added security.'}
      </p>
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
    color: '#8b949e',
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
