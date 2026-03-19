/**
 * SessionSettings — Configurable session timeout and auto-lock panel.
 *
 * - "Session Timeout" dropdown: 5 min, 10 min, 30 min, 1 hour, 4 hours, Never
 * - "Auto-lock on inactivity" toggle — locks the app after the timeout
 * - Settings are stored in localStorage (not sensitive — just duration preferences)
 */

import React, { useState, useCallback } from 'react';
import {
  SESSION_TIMEOUT_OPTIONS,
  getSavedTimeout,
  setSavedTimeout,
  getAutoLock,
  setAutoLock,
} from '../hooks/useSessionTimeout';
import { setSessionTimeout } from '../api/client';

const SessionSettings: React.FC = () => {
  const [timeoutMs, setTimeoutMs] = useState<number>(getSavedTimeout);
  const [autoLock, setAutoLockState] = useState<boolean>(getAutoLock);

  const handleTimeoutChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = Number(e.target.value);
      setTimeoutMs(value);
      setSavedTimeout(value);
      // Also update the API client's session timeout
      setSessionTimeout(value);
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

  return (
    <div style={styles.container}>
      <h3 style={styles.heading}>Session Security</h3>

      {/* Session Timeout dropdown */}
      <div style={styles.row}>
        <label htmlFor="session-timeout" style={styles.label}>
          Session Timeout
        </label>
        <select
          id="session-timeout"
          value={timeoutMs}
          onChange={handleTimeoutChange}
          style={styles.select}
        >
          {SESSION_TIMEOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
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
  select: {
    padding: '6px 10px',
    fontSize: 13,
    borderRadius: 6,
    border: '1px solid #30363d',
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
    fontFamily: 'inherit',
    cursor: 'pointer',
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
