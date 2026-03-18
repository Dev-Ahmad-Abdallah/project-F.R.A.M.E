/**
 * SignInPage — Wraps the AuthFlow component in a styled page
 * with a back link to the landing page and consistent dark theme.
 */

import React from 'react';
import type { AuthResponse } from '@frame/shared';
import AuthFlow from '../components/AuthFlow';

interface SignInPageProps {
  onAuthenticated: (auth: AuthResponse) => void;
  onBack: () => void;
}

export default function SignInPage({ onAuthenticated, onBack }: SignInPageProps) {
  return (
    <div style={styles.wrapper}>
      {/* Top bar with back link and logo */}
      <div style={styles.topBar}>
        <button type="button" onClick={onBack} style={styles.backButton}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ marginRight: 6 }}>
            <path d="M11 4L6 9l5 5" stroke="#58a6ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <span style={styles.logo}>F.R.A.M.E.</span>
        <div style={{ width: 80 }} /> {/* spacer for centering */}
      </div>

      {/* Auth flow */}
      <AuthFlow onAuthenticated={onAuthenticated} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh',
    backgroundColor: '#0d1117',
    display: 'flex',
    flexDirection: 'column',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    borderBottom: '1px solid #30363d',
    backgroundColor: 'rgba(13,17,23,0.9)',
    backdropFilter: 'blur(12px)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  backButton: {
    display: 'flex',
    alignItems: 'center',
    background: 'none',
    border: 'none',
    color: '#58a6ff',
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '4px 0',
    minWidth: 80,
  },
  logo: {
    fontSize: 18,
    fontWeight: 700,
    color: '#f0f6fc',
    letterSpacing: 2,
  },
};
