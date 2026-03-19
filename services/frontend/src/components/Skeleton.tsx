/**
 * Skeleton — Reusable shimmer loading placeholder for F.R.A.M.E.
 *
 * Renders an animated gray bar that shimmers from left to right,
 * used as a placeholder while content is loading. Supports
 * configurable width, height, and border-radius.
 *
 * All styles are inline + injected keyframes. Dark theme consistent.
 */

import React, { useEffect } from 'react';

// Inject shimmer keyframes once
function injectSkeletonKeyframes(): void {
  const styleId = 'frame-skeleton-keyframes';
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes frame-skeleton-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
  `;
  document.head.appendChild(style);
}

interface SkeletonProps {
  width: string | number;
  height: number;
  borderRadius?: number;
  style?: React.CSSProperties;
}

const Skeleton: React.FC<SkeletonProps> = ({
  width,
  height,
  borderRadius = 4,
  style: extraStyle,
}) => {
  useEffect(() => {
    injectSkeletonKeyframes();
  }, []);

  return (
    <div
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height,
        borderRadius,
        background: 'linear-gradient(90deg, #21262d 25%, #30363d 50%, #21262d 75%)',
        backgroundSize: '200% 100%',
        animation: 'frame-skeleton-shimmer 1.5s ease-in-out infinite',
        flexShrink: 0,
        ...extraStyle,
      }}
    />
  );
};

/**
 * SkeletonMessageBubble — A skeleton placeholder shaped like a chat message bubble.
 */
export const SkeletonMessageBubble: React.FC<{
  align: 'left' | 'right';
  widthPercent?: number;
}> = ({ align, widthPercent = 60 }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-end',
      gap: 8,
      alignSelf: align === 'right' ? 'flex-end' : 'flex-start',
      maxWidth: `${widthPercent}%`,
      marginTop: 8,
    }}
  >
    {align === 'left' && (
      <Skeleton width={28} height={28} borderRadius={14} />
    )}
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '12px 14px',
        borderRadius: 12,
        backgroundColor: align === 'right' ? 'rgba(88, 166, 255, 0.06)' : '#161b22',
        border: `1px solid ${align === 'right' ? 'rgba(88, 166, 255, 0.12)' : '#30363d'}`,
        flex: 1,
      }}
    >
      {align === 'left' && (
        <Skeleton width={80} height={10} borderRadius={3} />
      )}
      <Skeleton width="100%" height={12} borderRadius={3} />
      <Skeleton width="70%" height={12} borderRadius={3} />
      <Skeleton
        width={50}
        height={8}
        borderRadius={3}
        style={{ marginTop: 2, alignSelf: 'flex-end', opacity: 0.5 }}
      />
    </div>
  </div>
);

/**
 * SkeletonRoomItem — A skeleton placeholder shaped like a room list item.
 */
export const SkeletonRoomItem: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 16px',
      borderBottom: '1px solid #21262d',
    }}
  >
    <Skeleton width={40} height={40} borderRadius={20} />
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton width={120} height={12} borderRadius={3} />
        <Skeleton width={36} height={8} borderRadius={3} style={{ opacity: 0.5 }} />
      </div>
      <Skeleton width="80%" height={10} borderRadius={3} style={{ opacity: 0.7 }} />
    </div>
  </div>
);

/**
 * SyncIndicator — Tiny animated dot indicator for active sync.
 * Shows three dots that pulse sequentially, like iMessage typing indicator
 * but smaller and used for sync status.
 */
export const SyncIndicator: React.FC = () => {
  useEffect(() => {
    const styleId = 'frame-sync-indicator-keyframes';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes frame-sync-dot {
        0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
        40% { opacity: 1; transform: scale(1.1); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        marginLeft: 6,
      }}
      title="Syncing messages..."
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            backgroundColor: '#58a6ff',
            animation: `frame-sync-dot 1.2s ease-in-out infinite`,
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  );
};

export default Skeleton;
