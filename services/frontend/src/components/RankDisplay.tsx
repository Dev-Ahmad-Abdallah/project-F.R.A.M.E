/**
 * RankDisplay — Full rank/achievement panel for the settings page.
 *
 * Shows all available ranks with unlock status, progress bar,
 * and descriptions. Uses the dark theme styling consistent with
 * other settings panels.
 */

import React from 'react';
import { RANKS, getUnlockedRanks, getProgress } from '../utils/rankSystem';
import type { Rank } from '../utils/rankSystem';
import { useIsMobile } from '../hooks/useIsMobile';

const RankDisplay: React.FC = () => {
  const isMobile = useIsMobile();
  const unlockedIds = getUnlockedRanks();
  const progress = getProgress();
  const progressPercent = progress.total > 0 ? (progress.unlocked / progress.total) * 100 : 0;

  return (
    <div style={{
      width: '100%',
      maxWidth: 440,
      padding: '20px 0',
    }}>
      <h3 style={{
        margin: '0 0 16px',
        fontSize: 16,
        fontWeight: 600,
        color: '#e6edf3',
      }}>
        Achievement Ranks
      </h3>

      {/* Progress bar */}
      <div style={{
        padding: 16,
        backgroundColor: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: 8,
        marginBottom: 16,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}>
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#8b949e',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.05em',
          }}>
            Progress
          </span>
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#d29922',
          }}>
            {progress.unlocked} / {progress.total}
          </span>
        </div>
        <div style={{
          height: 4,
          backgroundColor: '#21262d',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${progressPercent}%`,
            backgroundColor: '#d29922',
            borderRadius: 2,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Rank list */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {RANKS.map((rank: Rank) => {
          const isUnlocked = unlockedIds.includes(rank.id);

          return (
            <div
              key={rank.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? 10 : 12,
                padding: isMobile ? '12px 12px' : '10px 16px',
                backgroundColor: isUnlocked ? 'rgba(210, 153, 34, 0.06)' : '#0d1117',
                border: `1px solid ${isUnlocked ? 'rgba(210, 153, 34, 0.3)' : '#30363d'}`,
                borderRadius: 8,
                opacity: isUnlocked ? 1 : 0.5,
                transition: 'opacity 0.2s, border-color 0.2s',
              }}
            >
              {/* Icon */}
              <span style={{
                fontSize: isMobile ? 22 : 24,
                flexShrink: 0,
                filter: isUnlocked ? 'none' : 'grayscale(1)',
              }}>
                {rank.icon}
              </span>

              {/* Info */}
              <div style={{
                flex: 1,
                minWidth: 0,
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  <span style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: isUnlocked ? '#e6edf3' : '#8b949e',
                  }}>
                    {rank.name}
                  </span>
                  {isUnlocked && (
                    <span style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: '#3fb950',
                      backgroundColor: 'rgba(63, 185, 80, 0.1)',
                      border: '1px solid rgba(63, 185, 80, 0.3)',
                      borderRadius: 4,
                      padding: '1px 5px',
                      textTransform: 'uppercase' as const,
                      letterSpacing: '0.05em',
                    }}>
                      Unlocked
                    </span>
                  )}
                </div>
                <p style={{
                  margin: '2px 0 0',
                  fontSize: 11,
                  color: '#8b949e',
                  lineHeight: 1.3,
                }}>
                  {rank.description}
                </p>
                <p style={{
                  margin: '2px 0 0',
                  fontSize: 10,
                  color: '#6e7681',
                  fontStyle: 'italic',
                }}>
                  {rank.requirement}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RankDisplay;
