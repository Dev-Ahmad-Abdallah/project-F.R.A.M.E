/**
 * EncryptionVisualizer — E2EE handshake animation overlay for F.R.A.M.E.
 *
 * Plays a 2.5-second animation when opening a chat for the first time in a session:
 * 1. Two shield SVGs slide in from left and right (0-0.5s)
 * 2. A glowing green line connects them with traveling dots (0.5-1.2s)
 * 3. Key icons float from each shield to the other (1.2-1.8s)
 * 4. Shields pulse green, "SECURE CHANNEL ESTABLISHED" fades in (1.8-2.2s)
 * 5. Whole overlay fades out (2.2-2.5s)
 *
 * Uses sessionStorage to track shown state per room per browser session.
 * Pure CSS animations + inline SVGs (no external dependencies).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { fireGlitch } from '../hooks/useGlitchEffect';

const SESSION_KEY_PREFIX = 'frame-visualizer-shown-';

function hasShownForRoom(roomId: string): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY_PREFIX + roomId) === '1';
  } catch {
    return false;
  }
}

function markShownForRoom(roomId: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY_PREFIX + roomId, '1');
  } catch { /* ignore */ }
}

// Inject keyframes once
function injectVisualizerKeyframes(): void {
  const styleId = 'frame-e2ee-visualizer-keyframes';
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes frame-e2ee-shield-left {
      0% { transform: translateX(-120px); opacity: 0; }
      100% { transform: translateX(0); opacity: 1; }
    }
    @keyframes frame-e2ee-shield-right {
      0% { transform: translateX(120px); opacity: 0; }
      100% { transform: translateX(0); opacity: 1; }
    }
    @keyframes frame-e2ee-line-grow {
      0% { transform: scaleX(0); opacity: 0; }
      50% { opacity: 1; }
      100% { transform: scaleX(1); opacity: 1; }
    }
    @keyframes frame-e2ee-particle {
      0% { left: 0%; opacity: 0; }
      10% { opacity: 1; }
      90% { opacity: 1; }
      100% { left: 100%; opacity: 0; }
    }
    @keyframes frame-e2ee-particle-reverse {
      0% { left: 100%; opacity: 0; }
      10% { opacity: 1; }
      90% { opacity: 1; }
      100% { left: 0%; opacity: 0; }
    }
    @keyframes frame-e2ee-key-left {
      0% { transform: translateX(0); opacity: 0; }
      20% { opacity: 1; }
      100% { transform: translateX(80px); opacity: 1; }
    }
    @keyframes frame-e2ee-key-right {
      0% { transform: translateX(0); opacity: 0; }
      20% { opacity: 1; }
      100% { transform: translateX(-80px); opacity: 1; }
    }
    @keyframes frame-e2ee-text-fade {
      0% { opacity: 0; transform: scale(0.95); }
      100% { opacity: 1; transform: scale(1); }
    }
    @keyframes frame-e2ee-overlay-fadeout {
      0% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes frame-e2ee-glow-pulse {
      0%, 100% { filter: drop-shadow(0 0 6px rgba(63, 185, 80, 0.6)); }
      50% { filter: drop-shadow(0 0 14px rgba(63, 185, 80, 0.9)); }
    }
    @keyframes frame-e2ee-shield-pulse {
      0% { filter: drop-shadow(0 0 8px rgba(63, 185, 80, 0.4)); }
      50% { filter: drop-shadow(0 0 18px rgba(63, 185, 80, 1)); }
      100% { filter: drop-shadow(0 0 8px rgba(63, 185, 80, 0.4)); }
    }
  `;
  document.head.appendChild(style);
}

interface EncryptionVisualizerProps {
  roomId: string;
  onComplete: () => void;
}

const EncryptionVisualizer: React.FC<EncryptionVisualizerProps> = ({ roomId, onComplete }) => {
  const [phase, setPhase] = useState<'shields' | 'line' | 'keys' | 'text' | 'fadeout' | 'done'>('shields');
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    injectVisualizerKeyframes();
    if (hasShownForRoom(roomId)) {
      onComplete();
      return;
    }
    setShouldShow(true);
    markShownForRoom(roomId);
  }, [roomId, onComplete]);

  useEffect(() => {
    if (!shouldShow) return;
    // Trigger CRT glitch effect when E2EE handshake visualizer starts
    fireGlitch();
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setPhase('line'), 500));
    timers.push(setTimeout(() => setPhase('keys'), 1200));
    timers.push(setTimeout(() => setPhase('text'), 1800));
    timers.push(setTimeout(() => setPhase('fadeout'), 2200));
    timers.push(setTimeout(() => {
      setPhase('done');
      onComplete();
    }, 2500));
    return () => timers.forEach(clearTimeout);
  }, [shouldShow, onComplete]);

  const handleSkip = useCallback(() => {
    setPhase('done');
    onComplete();
  }, [onComplete]);

  if (!shouldShow || phase === 'done') return null;

  const isFadingOut = phase === 'fadeout';
  const showLine = phase === 'line' || phase === 'keys' || phase === 'text' || phase === 'fadeout';
  const showKeys = phase === 'keys' || phase === 'text' || phase === 'fadeout';
  const showText = phase === 'text' || phase === 'fadeout';
  const shieldsPulse = phase === 'text' || phase === 'fadeout';

  const shieldSvg = (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <path
        d="M24 4L8 12v12c0 11.2 6.8 21 16 24 9.2-3 16-12.8 16-24V12L24 4z"
        stroke="#3fb950"
        strokeWidth="2"
        fill="rgba(63, 185, 80, 0.08)"
      />
      <path
        d="M18 24l4 4 8-8"
        stroke="#3fb950"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );

  const keySvg = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );

  return (
    <div
      onClick={handleSkip}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(13, 17, 23, 0.9)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        cursor: 'pointer',
        ...(isFadingOut ? {
          animation: 'frame-e2ee-overlay-fadeout 0.3s ease-out forwards',
        } : {}),
      }}
      aria-label="E2EE handshake animation — click to skip"
    >
      {/* Shields + connection area */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        position: 'relative',
        width: 280,
        height: 80,
        marginBottom: 24,
      }}>
        {/* Left shield */}
        <div style={{
          animation: shieldsPulse
            ? 'frame-e2ee-shield-pulse 0.4s ease-in-out 2'
            : 'frame-e2ee-shield-left 0.5s ease-out forwards',
          filter: 'drop-shadow(0 0 8px rgba(63, 185, 80, 0.4))',
          position: 'absolute',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
        }}>
          {shieldSvg}
        </div>

        {/* Connection line + particles */}
        {showLine && (
          <div style={{
            position: 'absolute',
            left: 56,
            right: 56,
            top: '50%',
            height: 2,
            transform: 'translateY(-50%)',
          }}>
            {/* Glowing line */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              backgroundColor: '#3fb950',
              boxShadow: '0 0 8px rgba(63, 185, 80, 0.6), 0 0 16px rgba(63, 185, 80, 0.3)',
              transformOrigin: 'left center',
              animation: 'frame-e2ee-line-grow 0.7s ease-out forwards',
            }} />
            {/* Particles traveling along the line */}
            {[0, 1, 2].map((i) => (
              <div key={`p-${i}`} style={{
                position: 'absolute',
                top: -2,
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: '#3fb950',
                boxShadow: '0 0 6px rgba(63, 185, 80, 0.8)',
                animation: `frame-e2ee-particle 0.8s ease-in-out ${i * 0.2}s infinite`,
              }} />
            ))}
            {[0, 1].map((i) => (
              <div key={`pr-${i}`} style={{
                position: 'absolute',
                top: -2,
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: '#58a6ff',
                boxShadow: '0 0 6px rgba(88, 166, 255, 0.8)',
                animation: `frame-e2ee-particle-reverse 0.9s ease-in-out ${i * 0.3 + 0.1}s infinite`,
              }} />
            ))}
          </div>
        )}

        {/* Key exchange */}
        {showKeys && (
          <>
            <div style={{
              position: 'absolute',
              left: 56,
              top: '50%',
              transform: 'translateY(-50%)',
              animation: 'frame-e2ee-key-left 0.6s ease-out forwards',
            }}>
              {keySvg}
            </div>
            <div style={{
              position: 'absolute',
              right: 56,
              top: '50%',
              transform: 'translateY(-50%)',
              animation: 'frame-e2ee-key-right 0.6s ease-out forwards',
            }}>
              {keySvg}
            </div>
          </>
        )}

        {/* Right shield */}
        <div style={{
          animation: shieldsPulse
            ? 'frame-e2ee-shield-pulse 0.4s ease-in-out 2'
            : 'frame-e2ee-shield-right 0.5s ease-out forwards',
          filter: 'drop-shadow(0 0 8px rgba(63, 185, 80, 0.4))',
          position: 'absolute',
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
        }}>
          {shieldSvg}
        </div>
      </div>

      {/* Secure channel text */}
      {showText && (
        <div style={{
          animation: 'frame-e2ee-text-fade 0.4s ease-out forwards',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: '#3fb950',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            textShadow: '0 0 12px rgba(63, 185, 80, 0.6), 0 0 24px rgba(63, 185, 80, 0.3)',
            animation: 'frame-e2ee-glow-pulse 1.5s ease-in-out infinite',
            fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
          }}>
            {'\uD83D\uDD12'} SECURE CHANNEL ESTABLISHED
          </div>
          <div style={{
            fontSize: 11,
            color: '#8b949e',
            marginTop: 8,
          }}>
            End-to-end encrypted with F.R.A.M.E. protocol
          </div>
        </div>
      )}

      {/* Skip hint */}
      <div style={{
        position: 'absolute',
        bottom: 24,
        fontSize: 11,
        color: '#484f58',
      }}>
        Click anywhere to skip
      </div>
    </div>
  );
};

export default EncryptionVisualizer;
