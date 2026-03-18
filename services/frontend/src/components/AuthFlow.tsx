/**
 * AuthFlow — Login / Register UI for F.R.A.M.E.
 *
 * Renders a simple form that toggles between login and register modes.
 * On register, generates placeholder identity key material (to be
 * replaced by real vodozemac keys in Phase D).
 */

import React, { useState, useCallback } from 'react';
import type { AuthResponse } from '@frame/shared/api';
import { login, register } from '../api/authAPI';
import { FrameApiError } from '../api/client';

// ── Placeholder key generation ──

function generatePlaceholderKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generatePlaceholderKeys() {
  return {
    identityKey: generatePlaceholderKey(),
    signedPrekey: generatePlaceholderKey(),
    signedPrekeySig: generatePlaceholderKey(),
    oneTimePrekeys: Array.from({ length: 5 }, () => generatePlaceholderKey()),
  };
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
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
  },
  card: {
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    padding: 32,
    width: 360,
    maxWidth: '90vw',
  },
  title: {
    margin: 0,
    marginBottom: 4,
    fontSize: 22,
    fontWeight: 600,
    color: '#f0f6fc',
    textAlign: 'center' as const,
  },
  subtitle: {
    margin: 0,
    marginBottom: 24,
    fontSize: 13,
    color: '#8b949e',
    textAlign: 'center' as const,
  },
  label: {
    display: 'block',
    marginBottom: 6,
    fontSize: 14,
    fontWeight: 500,
    color: '#c9d1d9',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    marginBottom: 16,
    fontSize: 14,
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 6,
    color: '#c9d1d9',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  button: {
    width: '100%',
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  toggle: {
    marginTop: 16,
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
  },
  error: {
    backgroundColor: '#3d1a1a',
    border: '1px solid #6e3630',
    borderRadius: 6,
    padding: '8px 12px',
    marginBottom: 16,
    fontSize: 13,
    color: '#f85149',
  },
};

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

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);

      try {
        let auth: AuthResponse;

        if (mode === 'register') {
          const keys = generatePlaceholderKeys();
          auth = await register({
            username,
            password,
            ...keys,
          });
        } else {
          auth = await login({ username, password });
        }

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

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>F.R.A.M.E.</h1>
        <p style={styles.subtitle}>
          {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
        </p>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label style={styles.label} htmlFor="frame-username">
            Username
          </label>
          <input
            id="frame-username"
            style={styles.input}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            disabled={loading}
          />

          <label style={styles.label} htmlFor="frame-password">
            Password
          </label>
          <input
            id="frame-password"
            style={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
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
            {loading
              ? 'Please wait...'
              : mode === 'login'
                ? 'Sign In'
                : 'Create Account'}
          </button>
        </form>

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
    </div>
  );
}
