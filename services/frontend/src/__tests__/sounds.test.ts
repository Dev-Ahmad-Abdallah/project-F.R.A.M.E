/**
 * Tests for the sound system (preferences and no-throw guarantees).
 *
 * Note: The actual AudioContext is not available in jsdom, but we test
 * that the preference system works and that sound functions don't throw
 * when AudioContext is unavailable.
 */

import {
  isSoundEnabled,
  setSoundEnabled,
  playSendSound,
  playReceiveSound,
  playDestructSound,
  playJoinSound,
  playErrorSound,
} from '../utils/soundEngine';

// ── Sound preference (localStorage) ──

describe('sound preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isSoundEnabled() returns true by default (no localStorage entry)', () => {
    expect(isSoundEnabled()).toBe(true);
  });

  it('setSoundEnabled(false) makes isSoundEnabled() return false', () => {
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
  });

  it('setSoundEnabled(true) makes isSoundEnabled() return true', () => {
    setSoundEnabled(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });

  it('persists preference across calls', () => {
    setSoundEnabled(false);
    // Simulate a "fresh read" by checking localStorage directly
    expect(localStorage.getItem('frame-sounds-enabled')).toBe('false');
    expect(isSoundEnabled()).toBe(false);
  });

  it('stores "true" string in localStorage', () => {
    setSoundEnabled(true);
    expect(localStorage.getItem('frame-sounds-enabled')).toBe('true');
  });
});

// ── Sound functions don't throw ──

describe('sound playback functions (no-throw)', () => {
  // In jsdom, AudioContext is not available, so these functions should
  // gracefully handle the missing API without throwing.

  it('playSendSound() does not throw', () => {
    expect(() => playSendSound()).not.toThrow();
  });

  it('playReceiveSound() does not throw', () => {
    expect(() => playReceiveSound()).not.toThrow();
  });

  it('playDestructSound() does not throw', () => {
    expect(() => playDestructSound()).not.toThrow();
  });

  it('playJoinSound() does not throw', () => {
    expect(() => playJoinSound()).not.toThrow();
  });

  it('playErrorSound() does not throw', () => {
    expect(() => playErrorSound()).not.toThrow();
  });

  it('sound functions do not throw when sounds are disabled', () => {
    setSoundEnabled(false);
    expect(() => playSendSound()).not.toThrow();
    expect(() => playReceiveSound()).not.toThrow();
    expect(() => playDestructSound()).not.toThrow();
    expect(() => playJoinSound()).not.toThrow();
    expect(() => playErrorSound()).not.toThrow();
  });
});
