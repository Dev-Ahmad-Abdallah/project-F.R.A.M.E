/**
 * SignInPage — Wraps the AuthFlow component in a styled page
 * with a back link to the landing page and consistent dark theme.
 */

import React, { useEffect } from 'react';
import type { AuthResponse } from '@frame/shared';
import AuthFlow from '../components/AuthFlow';
import { FONT_BODY } from '../globalStyles';

interface SignInPageProps {
  onAuthenticated: (auth: AuthResponse) => void;
  onBack: () => void;
}

export default function SignInPage({ onAuthenticated, onBack }: SignInPageProps) {
  // Inject mobile styles for this page
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-frame-signin-mobile', '');
    style.textContent = signinMobileStyles;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  return (
    <div style={styles.wrapper}>
      {/* Top bar with back link and logo */}
      <div style={styles.topBar}>
        <button type="button" onClick={onBack} style={styles.backButton} className="frame-back-button">
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

const signinMobileStyles = `
@media (max-width: 600px) {
  /* Back button — larger touch target on mobile */
  .frame-back-button {
    min-height: 44px !important;
    min-width: 44px !important;
    padding: clamp(8px, 2vw, 12px) clamp(12px, 3vw, 16px) !important;
    font-size: clamp(14px, 4vw, 16px) !important;
    border-radius: 6px !important;
    margin: -4px !important;
  }
  .frame-back-button:active {
    background: rgba(88, 166, 255, 0.1) !important;
  }
  /* Prevent horizontal overflow on sign-in page */
  body {
    overflow-x: hidden !important;
  }
}
`;

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100dvh',
    backgroundColor: '#0d1117',
    display: 'flex',
    flexDirection: 'column',
    overflowX: 'hidden',
    maxWidth: '100vw',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px clamp(12px, 4vw, 24px)',
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
    fontFamily: FONT_BODY,
    padding: '4px 0',
    minWidth: 80,
  },
  logo: {
    fontSize: 16,
    fontWeight: 700,
    color: '#3fb950',
    letterSpacing: 4,
    fontFamily: '"SF Mono", "Fira Code", monospace',
    filter: 'drop-shadow(0 0 6px rgba(63,185,80,0.3))',
  },
};
