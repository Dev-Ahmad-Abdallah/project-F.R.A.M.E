/**
 * AuthFlow — Login / Register UI for F.R.A.M.E.
 *
 * Renders a form that toggles between login and register modes.
 * On register, generates placeholder identity key material (to be
 * replaced by real vodozemac keys in Phase D).
 *
 * Enhanced auth UX inspired by:
 *  - Signal's minimal, trust-forward auth
 *  - Discord's welcoming micro-interactions
 *  - Linear's clean transitions
 *  - Notion's smooth state changes
 *
 * Styled to match the landing page dark-theme aesthetic.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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

// ── Password strength evaluator ──

type PasswordStrength = 'none' | 'weak' | 'medium' | 'strong';

function evaluatePasswordStrength(pw: string): PasswordStrength {
  if (pw.length === 0) return 'none';
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (score <= 2) return 'weak';
  if (score <= 3) return 'medium';
  return 'strong';
}

function getStrengthInfo(s: PasswordStrength): { color: string; width: string; label: string } | null {
  if (s === 'weak') return { color: '#f85149', width: '33%', label: 'Weak' };
  if (s === 'medium') return { color: '#d29922', width: '66%', label: 'Medium' };
  if (s === 'strong') return { color: '#3fb950', width: '100%', label: 'Strong' };
  return null;
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
  const [showPassword, setShowPassword] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [modeTransition, setModeTransition] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const passwordStrength = useMemo(() => evaluatePasswordStrength(password), [password]);
  const strengthInfo = useMemo(() => getStrengthInfo(passwordStrength), [passwordStrength]);

  // Focus username field on mode change
  useEffect(() => {
    usernameRef.current?.focus();
  }, [mode]);

  // Trigger shake animation on error
  useEffect(() => {
    if (error) {
      setShaking(true);
      const timer = setTimeout(() => setShaking(false), 500);
      return () => clearTimeout(timer);
    }
  }, [error]);

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

          // Show success animation before redirecting
          setLoading(false);
          setShowSuccess(true);

          // Persist device ID
          sessionStorage.setItem(
            `frame-device-id:${auth.userId.split(':')[0].slice(1)}`,
            auth.deviceId,
          );

          // Brief pause for the success animation, then redirect
          setTimeout(() => {
            onAuthenticated(auth);
          }, 1200);
          return;
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
    setModeTransition(true);
    setTimeout(() => {
      setMode((m) => (m === 'login' ? 'register' : 'login'));
      setError(null);
      setPassword('');
      setShowPassword(false);
      setTimeout(() => setModeTransition(false), 20);
    }, 200);
  }, []);

  const inputFocusStyle = (field: string): React.CSSProperties => ({
    ...styles.input,
    ...(focusedField === field ? { borderColor: '#58a6ff', boxShadow: '0 0 0 2px rgba(88,166,255,0.15)' } : {}),
  });

  // ── Success overlay ──
  if (showSuccess) {
    return (
      <div style={styles.container}>
        <div style={styles.bgGrid} />
        <div style={{ ...styles.card, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 260 }}>
          <div style={styles.successCircle}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="#3fb950" strokeWidth="2" fill="rgba(63,185,80,0.08)" style={{ animation: 'frame-success-circle 0.4s ease-out forwards' }} />
              <path d="M15 24l6 6 12-12" stroke="#3fb950" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ animation: 'frame-success-check 0.3s ease-out 0.3s forwards', strokeDasharray: 30, strokeDashoffset: 30 }} />
            </svg>
          </div>
          <p style={{ color: '#3fb950', fontSize: 16, fontWeight: 600, marginTop: 16, animation: 'frame-fade-in 0.3s ease 0.5s forwards', opacity: 0 }}>
            Account created successfully
          </p>
          <p style={{ color: '#8b949e', fontSize: 13, marginTop: 4, animation: 'frame-fade-in 0.3s ease 0.7s forwards', opacity: 0 }}>
            Generating encryption keys...
          </p>
        </div>
        <style>{keyframes}</style>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Subtle background grid (matches landing page) */}
      <div style={styles.bgGrid} />

      <div
        style={{
          ...styles.card,
          ...(shaking ? { animation: 'frame-shake 0.4s ease-in-out' } : {}),
          ...(modeTransition ? { opacity: 0, transform: 'translateY(8px)' } : { opacity: 1, transform: 'translateY(0)' }),
          transition: 'opacity 0.2s ease, transform 0.2s ease',
        }}
      >
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

        <form ref={formRef} onSubmit={(e) => void handleSubmit(e)}>
          <label style={styles.label} htmlFor="frame-username">
            Username
          </label>
          <input
            ref={usernameRef}
            id="frame-username"
            style={inputFocusStyle('username')}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onFocus={() => setFocusedField('username')}
            onBlur={() => setFocusedField(null)}
            autoComplete="username"
            placeholder={mode === 'register' ? 'e.g. alice (letters, numbers, ._=-/)' : '@alice:frame.local'}
            required
            disabled={loading}
          />

          <label style={styles.label} htmlFor="frame-password">
            Password
          </label>
          <div style={styles.passwordWrapper}>
            <input
              ref={passwordRef}
              id="frame-password"
              style={{
                ...inputFocusStyle('password'),
                paddingRight: 40,
                marginBottom: 0,
              }}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              placeholder={mode === 'register' ? 'Min 8 chars, mix upper/lower/numbers' : 'Enter your password'}
              required
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              style={styles.eyeButton}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                /* Eye-off icon */
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                  <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                /* Eye icon */
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {/* Password strength indicator (register only) */}
          {mode === 'register' && (
            <div style={styles.strengthContainer}>
              <div style={styles.strengthTrack}>
                <div
                  style={{
                    ...styles.strengthBar,
                    ...(strengthInfo
                      ? { width: strengthInfo.width, backgroundColor: strengthInfo.color }
                      : { width: '0%' }),
                  }}
                />
              </div>
              {strengthInfo && (
                <span
                  style={{
                    fontSize: 11,
                    color: strengthInfo.color,
                    fontWeight: 500,
                    minWidth: 52,
                    textAlign: 'right' as const,
                  }}
                >
                  {strengthInfo.label}
                </span>
              )}
            </div>
          )}

          <button
            type="submit"
            style={{
              ...styles.button,
              ...(loading ? styles.buttonDisabled : {}),
              marginTop: mode === 'register' ? 8 : 20,
            }}
            disabled={loading}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {/* Lock spinner icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ animation: 'frame-lock-spin 1.2s ease-in-out infinite' }}>
                  <rect x="5" y="11" width="14" height="10" rx="2" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" fill="none" />
                  <path d="M8 11V7a4 4 0 118 0v4" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" fill="none" style={{ animation: 'frame-lock-jiggle 1.2s ease-in-out infinite' }} />
                  <circle cx="12" cy="16" r="1.5" fill="rgba(255,255,255,0.9)" />
                </svg>
                {mode === 'register' ? 'Creating account...' : 'Signing in...'}
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

        {/* Keyboard shortcut hint */}
        <p style={styles.shortcutHint}>
          Press <kbd style={styles.kbd}>Enter</kbd> to submit &middot; <kbd style={styles.kbd}>Tab</kbd> to navigate
        </p>
      </div>

      {/* Inject keyframes */}
      <style>{keyframes}</style>
    </div>
  );
}

// ── Keyframes (injected via <style> tag) ──

const keyframes = `
@keyframes frame-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes frame-shake {
  0%, 100% { transform: translateX(0); }
  10%, 50%, 90% { transform: translateX(-6px); }
  30%, 70% { transform: translateX(6px); }
}

@keyframes frame-lock-spin {
  0% { transform: rotate(0deg); }
  25% { transform: rotate(10deg); }
  50% { transform: rotate(0deg); }
  75% { transform: rotate(-10deg); }
  100% { transform: rotate(0deg); }
}

@keyframes frame-lock-jiggle {
  0%, 100% { transform: translateY(0); }
  25% { transform: translateY(-1px); }
  75% { transform: translateY(1px); }
}

@keyframes frame-success-circle {
  from { transform: scale(0.8); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@keyframes frame-success-check {
  to { stroke-dashoffset: 0; }
}

@keyframes frame-fade-in {
  to { opacity: 1; }
}
`;

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
  passwordWrapper: {
    position: 'relative' as const,
    marginBottom: 16,
  },
  eyeButton: {
    position: 'absolute' as const,
    right: 8,
    top: 8,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    opacity: 0.7,
    transition: 'opacity 0.15s',
  },
  strengthContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: -8,
    marginBottom: 8,
  },
  strengthTrack: {
    flex: 1,
    height: 3,
    backgroundColor: '#21262d',
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  strengthBar: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.3s ease, background-color 0.3s ease',
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
  successCircle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutHint: {
    marginTop: 12,
    marginBottom: 0,
    fontSize: 11,
    color: '#484f58',
    textAlign: 'center' as const,
  },
  kbd: {
    display: 'inline-block',
    padding: '1px 5px',
    fontSize: 10,
    fontFamily: 'inherit',
    color: '#8b949e',
    backgroundColor: '#21262d',
    border: '1px solid #30363d',
    borderRadius: 3,
    lineHeight: '16px',
  },
};
