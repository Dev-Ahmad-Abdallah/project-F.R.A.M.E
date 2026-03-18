import React, { useState, useCallback } from 'react';
import type { AuthResponse } from '@frame/shared/api';
import AuthFlow from './components/AuthFlow';
import { clearTokens } from './api/client';

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
    textAlign: 'center' as const,
    minWidth: 320,
  },
  heading: {
    margin: 0,
    marginBottom: 8,
    fontSize: 22,
    fontWeight: 600,
    color: '#f0f6fc',
  },
  userId: {
    margin: 0,
    marginBottom: 24,
    fontSize: 14,
    color: '#8b949e',
  },
  placeholder: {
    margin: '0 0 24px',
    fontSize: 14,
    color: '#8b949e',
    fontStyle: 'italic',
  },
  logoutButton: {
    padding: '8px 20px',
    fontSize: 14,
    fontWeight: 500,
    backgroundColor: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
  },
};

function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);

  const handleLogout = useCallback(() => {
    clearTokens();
    setAuth(null);
  }, []);

  // ── Not authenticated → show auth flow ──
  if (!auth) {
    return <AuthFlow onAuthenticated={setAuth} />;
  }

  // ── Authenticated → placeholder chat view ──
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.heading}>F.R.A.M.E.</h1>
        <p style={styles.userId}>Logged in as {auth.userId}</p>
        <p style={styles.placeholder}>
          Chat view coming in Phase D. Device ID: {auth.deviceId}
        </p>
        <button type="button" style={styles.logoutButton} onClick={handleLogout}>
          Log Out
        </button>
      </div>
    </div>
  );
}

export default App;
