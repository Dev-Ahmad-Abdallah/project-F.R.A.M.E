/**
 * Notification sounds for F.R.A.M.E. — generated programmatically via Web Audio API.
 *
 * No external audio files needed. All sounds are short (< 500ms) and subtle.
 * Sound preference is persisted in localStorage under `frame-sounds-enabled`.
 *
 * This module re-exports from utils/soundEngine.ts and provides backward-compatible
 * aliases (playMessageSound, playNotificationSound) for existing call sites.
 */

import {
  isSoundEnabled,
  setSoundEnabled,
  playSendSound,
  playReceiveSound,
  playDestructSound,
  playJoinSound,
  playErrorSound,
} from './utils/soundEngine';

// ── Re-export core sound engine ──

export {
  isSoundEnabled,
  setSoundEnabled,
  playSendSound,
  playReceiveSound,
  playDestructSound,
  playJoinSound,
  playErrorSound,
};

// ── Backward-compatible aliases ──

/** Alias for playReceiveSound — used by existing sync loop and notification code. */
export const playMessageSound = playReceiveSound;

/** Alias for playReceiveSound — used by background notification handler. */
export const playNotificationSound = playReceiveSound;
