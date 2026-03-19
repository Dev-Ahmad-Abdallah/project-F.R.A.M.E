/**
 * AuthFlow — Login / Register UI for F.R.A.M.E.
 *
 * Renders a form that toggles between login and register modes.
 * On register, generates placeholder identity key material (to be
 * replaced by real vodozemac keys in Phase D).
 *
 * Styled to match the landing page dark-theme aesthetic.
 */

import React, { useState, useCallback } from 'react';
import type { AuthResponse } from '@frame/shared';
import { login, register } from '../api/authAPI';
import { FrameApiError } from '../api/client';
import { generateAndUploadKeys } from '../crypto/keyManager';

// ── Placeholder key generation (for initial register payload only) ──

function generatePlaceholderKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateInitialPlaceholderKeys() {
  return {
    identityKey: generatePlaceholderKey(),
    signedPrekey: generatePlaceholderKey(),
    signedPrekeySig: generatePlaceholderKey(),
    oneTimePrekeys: Array.from({ length: 5 }, () => generatePlaceholderKey()),
  };
}

// ── Component ──

interface AuthFlowProps {
  onAuthenticated: (auth: AuthResponse) => void;
}

export default function AuthFlow({ onAuthenticated }: AuthFlowProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);

      try {
        let auth: AuthResponse;

        if (mode === 'register') {
          const keys = generateInitialPlaceholderKeys();
          auth = await register({
            username,
            password,
            ...keys,
          });

          // SECURITY: vodozemac key generation MUST succeed for E2EE to work.
          // If it fails, abort registration — never continue with placeholder keys.
          await generateAndUploadKeys(auth.userId, auth.deviceId);
        } else {
          // Reuse device ID from previous login if available
          const storedDeviceId = sessionStorage.getItem(`frame-device-id:${username}`) ?? undefined;
          auth = await login({ username, password, deviceId: storedDeviceId });
        }

        // Persist device ID for current session (cleared on tab close, more secure against persistent XSS)
        sessionStorage.setItem(`frame-device-id:${auth.userId.split(':')[0].slice(1)}`, auth.deviceId);

        onAuthenticated(auth);
      } catch (err) {
        if (err instanceof FrameApiError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unexpected error occurred.');
        }
      } finally {
        setLoading(false);
      }
    },
    [mode, username, password, onAuthenticated],
  );

  const toggleMode = useCallback(() => {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError(null);
  }, []);

  const inputFocusStyle = (field: string): React.CSSProperties => ({
    ...styles.input,
    ...(focusedField === field ? { borderColor: '#58a6ff', boxShadow: '0 0 0 2px rgba(88,166,255,0.15)' } : {}),
  });

  return (
    <div style={styles.container}>
      {/* Subtle background grid (matches landing page) */}
      <div style={styles.bgGrid} />

      <div style={styles.card}>
        {/* Shield icon */}
        <div style={styles.iconWrapper}>
          <svg width="40" height="40" viewBox="0 0 64 64" fill="none">
            <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke="#58a6ff" strokeWidth="2" fill="rgba(88,166,255,0.06)" />
            <path d="M26 32l4 4 8-8" stroke="#3fb950" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>

        <h1 style={styles.title}>F.R.A.M.E.</h1>
        <p style={styles.subtitle}>
          {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
        </p>

        {error && (
          <div style={styles.error}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="7" cy="7" r="6" stroke="#f85149" strokeWidth="1.5" fill="none" />
              <path d="M7 4v3M7 9v.5" stroke="#f85149" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)}>
          <label style={styles.label} htmlFor="frame-username">
            Username
          </label>
          <input
            id="frame-username"
            style={inputFocusStyle('username')}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onFocus={() => setFocusedField('username')}
            onBlur={() => setFocusedField(null)}
            autoComplete="username"
            placeholder="@username:homeserver"
            required
            disabled={loading}
          />

          <label style={styles.label} htmlFor="frame-password">
            Password
          </label>
          <input
            id="frame-password"
            style={inputFocusStyle('password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={() => setFocusedField('password')}
            onBlur={() => setFocusedField(null)}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            placeholder={mode === 'register' ? 'Choose a strong password' : 'Enter your password'}
            required
            disabled={loading}
          />

          <button
            type="submit"
            style={{
              ...styles.button,
              ...(loading ? styles.buttonDisabled : {}),
            }}
            disabled={loading}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" style={{ animation: 'frame-spin 1s linear infinite' }}>
                  <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" strokeWidth="2" fill="none" />
                  <path d="M14 8a6 6 0 00-6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none" />
                </svg>
                Please wait...
              </span>
            ) : mode === 'login' ? (
              'Sign In'
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        {/* Encryption notice */}
        <div style={styles.encryptionNotice}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <rect x="5" y="10" width="14" height="10" rx="2" stroke="#3fb950" strokeWidth="1.5" fill="rgba(63,185,80,0.1)" />
            <path d="M8 10V7a4 4 0 118 0v3" stroke="#3fb950" strokeWidth="1.5" fill="none" />
          </svg>
          <span style={{ fontSize: 11, color: '#8b949e' }}>
            End-to-end encrypted. Keys generated on your device.
          </span>
        </div>

        <p style={styles.toggle}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            style={styles.toggleLink}
            onClick={toggleMode}
            disabled={loading}
          >
            {mode === 'login' ? 'Register' : 'Sign In'}
          </button>
        </p>
      </div>

      {/* Inject spinner keyframe */}
      <style>{`@keyframes frame-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Styles ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
    position: 'relative',
    overflow: 'hidden',
  },
  bgGrid: {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'linear-gradient(#30363d22 1px, transparent 1px), linear-gradient(90deg, #30363d22 1px, transparent 1px)',
    backgroundSize: '48px 48px',
    pointerEvents: 'none',
    opacity: 0.4,
  },
  card: {
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 12,
    padding: '36px 32px 28px',
    width: 380,
    maxWidth: '90vw',
    position: 'relative',
    zIndex: 1,
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.3)',
  },
  iconWrapper: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    margin: 0,
    marginBottom: 4,
    fontSize: 24,
    fontWeight: 700,
    color: '#f0f6fc',
    textAlign: 'center' as const,
    letterSpacing: 1.5,
  },
  subtitle: {
    margin: 0,
    marginBottom: 28,
    fontSize: 14,
    color: '#8b949e',
    textAlign: 'center' as const,
  },
  label: {
    display: 'block',
    marginBottom: 6,
    fontSize: 13,
    fontWeight: 500,
    color: '#c9d1d9',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    marginBottom: 16,
    fontSize: 14,
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 6,
    color: '#c9d1d9',
    boxSizing: 'border-box' as const,
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  button: {
    width: '100%',
    padding: '11px 16px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#58a6ff',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background-color 0.15s, transform 0.1s',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  encryptionNotice: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    padding: '8px 0',
  },
  toggle: {
    marginTop: 12,
    marginBottom: 0,
    fontSize: 13,
    color: '#8b949e',
    textAlign: 'center' as const,
  },
  toggleLink: {
    background: 'none',
    border: 'none',
    color: '#58a6ff',
    cursor: 'pointer',
    fontSize: 13,
    textDecoration: 'underline',
    padding: 0,
    fontFamily: 'inherit',
  },
  error: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#3d1f28',
    border: '1px solid #6e3630',
    borderRadius: 6,
    padding: '10px 12px',
    marginBottom: 16,
    fontSize: 13,
    color: '#f85149',
  },
};
