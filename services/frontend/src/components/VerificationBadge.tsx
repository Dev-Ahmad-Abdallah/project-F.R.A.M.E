/**
 * VerificationBadge — Reusable verification status indicator.
 *
 * Shows a green shield when verified, yellow warning when not.
 * Includes a tooltip explaining the status.
 */

import React, { useState } from 'react';

// ── Types ──

interface VerificationBadgeProps {
  verified: boolean;
  size?: 'small' | 'medium';
}

// ── Component ──

const VerificationBadge: React.FC<VerificationBadgeProps> = ({
  verified,
  size = 'medium',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const iconSize = size === 'small' ? 16 : 22;
  const tooltipText = verified
    ? 'This device has been verified and is trusted.'
    : 'This device has not been verified. Verify it to ensure secure communication.';

  return (
    <span
      style={styles.wrapper}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      aria-label={tooltipText}
      role="img"
    >
      {verified ? (
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={styles.icon}
        >
          {/* Shield with check mark */}
          <path
            d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"
            fill="#238636"
          />
          <path
            d="M10 15.5l-3.5-3.5 1.41-1.41L10 12.67l5.59-5.58L17 8.5l-7 7z"
            fill="#ffffff"
          />
        </svg>
      ) : (
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={styles.icon}
        >
          {/* Warning triangle */}
          <path
            d="M1 21h22L12 2 1 21z"
            fill="#d29922"
          />
          <path
            d="M13 18h-2v-2h2v2zm0-4h-2V9h2v5z"
            fill="#0d1117"
          />
        </svg>
      )}

      {/* Tooltip */}
      {showTooltip && (
        <span
          style={{
            ...styles.tooltip,
            ...(size === 'small' ? styles.tooltipSmall : {}),
          }}
        >
          {tooltipText}
        </span>
      )}
    </span>
  );
};

// ── Styles ──

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    cursor: 'default',
  },
  icon: {
    display: 'block',
    flexShrink: 0,
  },
  tooltip: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginBottom: 6,
    padding: '6px 10px',
    backgroundColor: '#1c2128',
    color: '#c9d1d9',
    fontSize: 12,
    lineHeight: 1.4,
    borderRadius: 6,
    border: '1px solid #30363d',
    whiteSpace: 'nowrap',
    maxWidth: 260,
    zIndex: 100,
    pointerEvents: 'none',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
  },
  tooltipSmall: {
    fontSize: 11,
    padding: '4px 8px',
    maxWidth: 220,
  },
};

export default VerificationBadge;
