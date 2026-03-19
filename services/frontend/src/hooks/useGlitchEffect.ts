/**
 * useGlitchEffect — CRT glitch animation hook for security events.
 *
 * When triggered, adds a CSS class to the app root that plays a glitch
 * animation for 0.5s, along with a brief scanline overlay (thin green
 * line moving top to bottom).
 *
 * Usage:
 *   const triggerGlitch = useGlitchEffect();
 *   triggerGlitch(); // fire the effect
 *
 * Alternatively, pass a reactive boolean:
 *   useGlitchEffect(shouldGlitch);
 */

import { useCallback, useEffect, useRef } from 'react';

// ── CSS class and keyframe injection ──

const GLITCH_STYLE_ID = 'frame-glitch-styles';
const GLITCH_CLASS = 'frame-glitch-active';
const SCANLINE_ID = 'frame-glitch-scanline';

function injectGlitchStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(GLITCH_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = GLITCH_STYLE_ID;
  style.textContent = `
    .${GLITCH_CLASS} {
      animation: frame-glitch 0.5s ease-out !important;
    }

    #${SCANLINE_ID} {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent 0%, #3fb950 30%, #3fb950 70%, transparent 100%);
      opacity: 0.7;
      z-index: 99999;
      pointer-events: none;
      animation: frame-scanline-sweep 0.5s linear forwards;
      box-shadow: 0 0 8px rgba(63, 185, 80, 0.5), 0 0 20px rgba(63, 185, 80, 0.2);
    }

    @keyframes frame-scanline-sweep {
      0% { top: -2px; opacity: 0.7; }
      100% { top: 100vh; opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

// ── Core trigger function ──

/**
 * Imperatively fire the glitch effect. Can be called outside React
 * (e.g. from the API client on rate-limit hits).
 */
export function fireGlitch(): void {
  if (typeof document === 'undefined') return;

  injectGlitchStyles();

  const root = document.getElementById('root') ?? document.body;

  // Remove class first if already active (allows re-triggering)
  root.classList.remove(GLITCH_CLASS);
  // Force reflow to restart animation
  void root.offsetWidth;
  root.classList.add(GLITCH_CLASS);

  // Create scanline overlay
  let scanline = document.getElementById(SCANLINE_ID);
  if (scanline) {
    scanline.remove();
  }
  scanline = document.createElement('div');
  scanline.id = SCANLINE_ID;
  document.body.appendChild(scanline);

  // Clean up after animation completes
  setTimeout(() => {
    root.classList.remove(GLITCH_CLASS);
    const el = document.getElementById(SCANLINE_ID);
    if (el) el.remove();
  }, 500);
}

// ── Hook ──

/**
 * Returns a function to trigger the glitch effect.
 * Optionally accepts a reactive boolean that triggers the effect
 * whenever it transitions from false to true.
 */
export function useGlitchEffect(trigger?: boolean): () => void {
  const prevTriggerRef = useRef(false);

  // Inject styles on mount
  useEffect(() => {
    injectGlitchStyles();
  }, []);

  // Watch the reactive trigger
  useEffect(() => {
    if (trigger && !prevTriggerRef.current) {
      fireGlitch();
    }
    prevTriggerRef.current = !!trigger;
  }, [trigger]);

  return useCallback(() => {
    fireGlitch();
  }, []);
}
