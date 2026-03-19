/**
 * soundEngine.ts — Tactical Sound Design for F.R.A.M.E.
 *
 * All sounds are generated procedurally via Web Audio API.
 * No external audio files needed. Volumes are kept LOW (gain 0.05–0.15).
 * Sounds should be felt, not heard.
 *
 * Browser autoplay policy compliance: AudioContext is resumed on first
 * user interaction via a one-time click handler installed at module load.
 */

const STORAGE_KEY = 'frame-sounds-enabled';

// ── Sound preference ──

/** Whether sounds are currently enabled (default: true). */
export function isSoundEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
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
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

// ── Resume AudioContext on first user interaction (autoplay policy) ──

let audioContextResumed = false;

function resumeAudioOnInteraction() {
  if (audioContextResumed) return;
  audioContextResumed = true;
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume();
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', resumeAudioOnInteraction, { once: true });
  document.addEventListener('touchstart', resumeAudioOnInteraction, { once: true });
  document.addEventListener('keydown', resumeAudioOnInteraction, { once: true });
}

// ── Sound generators ──

/**
 * Short sonar "blip" — sine wave 800Hz -> 1200Hz, 80ms, low volume.
 * Played when the user sends a message.
 */
export function playSendSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.linearRampToValueAtTime(1200, now + 0.08);
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.08);
  osc.start(now);
  osc.stop(now + 0.08);
}

/**
 * Soft chirp — two quick sine tones 600Hz + 900Hz, 60ms each.
 * Played when a new message is received from another user.
 */
export function playReceiveSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // First chirp — 600Hz
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(600, now);
  gain1.gain.setValueAtTime(0.08, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.06);

  // Second chirp — 900Hz, slightly delayed
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(900, now + 0.07);
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.setValueAtTime(0.08, now + 0.07);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.07);
  osc2.stop(now + 0.13);
}

/**
 * Low rumble — white noise filtered through lowpass, 300ms.
 * Played when a message self-destructs.
 */
export function playDestructSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const duration = 0.3;

  // Generate white noise buffer
  const bufferSize = Math.ceil(ctx.sampleRate * duration);
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;

  // Lowpass filter for rumble effect
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(150, now);
  filter.frequency.linearRampToValueAtTime(80, now + duration);
  filter.Q.setValueAtTime(1, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.linearRampToValueAtTime(0, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + duration);
}

/**
 * Radio static -> clear — noise -> sine, 200ms.
 * Played when joining a room/session.
 */
export function playJoinSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const duration = 0.2;

  // Static noise phase (first 120ms)
  const noiseLen = Math.ceil(ctx.sampleRate * 0.12);
  const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) {
    noiseData[i] = Math.random() * 2 - 1;
  }

  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuffer;

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.setValueAtTime(2000, now);
  noiseFilter.Q.setValueAtTime(0.5, now);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.06, now);
  noiseGain.gain.linearRampToValueAtTime(0, now + 0.12);

  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noiseSource.start(now);
  noiseSource.stop(now + 0.12);

  // Clear tone phase (last 80ms) — emerges from the static
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now + 0.1);
  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.setValueAtTime(0.1, now + 0.1);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(oscGain);
  oscGain.connect(ctx.destination);
  osc.start(now + 0.1);
  osc.stop(now + duration);
}

/**
 * Two low tones — 200Hz, 150Hz, 100ms each.
 * Played on errors and rate limits.
 */
export function playErrorSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // First low tone — 200Hz
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(200, now);
  gain1.gain.setValueAtTime(0.1, now);
  gain1.gain.linearRampToValueAtTime(0, now + 0.1);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.1);

  // Second low tone — 150Hz
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(150, now + 0.12);
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.setValueAtTime(0.1, now + 0.12);
  gain2.gain.linearRampToValueAtTime(0, now + 0.22);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.12);
  osc2.stop(now + 0.22);
}
