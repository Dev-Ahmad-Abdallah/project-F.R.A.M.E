/**
 * RankBadge — Displays the user's current military rank inline.
 *
 * Compact display: icon + rank name, suitable for sidebar user info.
 */

import React from 'react';
import { getCurrentRank } from '../utils/rankSystem';

interface RankBadgeProps {
  /** Override style for the container */
  style?: React.CSSProperties;
}

const RankBadge: React.FC<RankBadgeProps> = ({ style }) => {
  const rank = getCurrentRank();

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 10,
        fontWeight: 600,
        color: '#d29922',
        letterSpacing: '0.03em',
        ...style,
      }}
      title={`${rank.name} — ${rank.description}`}
      aria-label={`Rank: ${rank.name}`}
    >
      <span aria-hidden="true">{rank.icon}</span>
      <span>{rank.name}</span>
    </span>
  );
};

export default RankBadge;
