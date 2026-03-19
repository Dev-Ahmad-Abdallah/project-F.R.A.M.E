/**
 * Notification sounds for F.R.A.M.E. — generated programmatically via Web Audio API.
 *
 * No external audio files needed. All sounds are short (< 500ms) and pleasant.
 * Sound preference is persisted in localStorage under `frame:sounds-enabled`.
 */

const STORAGE_KEY = 'frame:sounds-enabled';

/** Whether sounds are currently enabled. */
export function isSoundEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Default to true if not set
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

/** Toggle sound on or off and persist the preference. */
export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in private browsing
  }
}

// ── Audio Context (lazy singleton) ──

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    // Resume if suspended (browsers require user gesture)
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

// ── Sound generators ──

/**
 * Play a short, pleasant two-tone chime (like iMessage) for incoming messages.
 * Duration: ~300ms
 */
export function playMessageSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // First tone — C6 (1047 Hz)
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(1047, now);
  gain1.gain.setValueAtTime(0.15, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.15);

  // Second tone — E6 (1319 Hz), slightly delayed
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1319, now + 0.12);
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.setValueAtTime(0.15, now + 0.12);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.12);
  osc2.stop(now + 0.3);
}

/**
 * Play a subtle single tone for background notifications.
 * Duration: ~200ms
 */
export function playNotificationSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now); // A5
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

/**
 * Play a very subtle "whoosh" for sent messages.
 * Uses filtered noise for a soft swoosh effect.
 * Duration: ~250ms
 */
export function playSendSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Use a sine wave with a quick frequency sweep for a soft "whoosh"
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.08);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.25);
  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.25);
}

/**
 * Play a low buzz for errors.
 * Duration: ~300ms
 */
export function playErrorSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Two low overlapping tones for a "buzz" feel
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'square';
  osc1.frequency.setValueAtTime(220, now); // A3
  gain1.gain.setValueAtTime(0.06, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.3);

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'square';
  osc2.frequency.setValueAtTime(196, now); // G3 — dissonant with A3
  gain2.gain.setValueAtTime(0.04, now);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now);
  osc2.stop(now + 0.3);
}
