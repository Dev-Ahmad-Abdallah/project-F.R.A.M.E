/**
 * Rank System for F.R.A.M.E.
 *
 * Military-style achievement ranks tracked client-side via localStorage.
 * Ranks are unlocked based on user activity within the app.
 *
 * Storage key: "frame-ranks" (JSON array of unlocked rank IDs).
 */

// ── Types ──

export interface Rank {
  id: string;
  name: string;
  icon: string;
  description: string;
  requirement: string;
}

// ── Rank definitions ──

export const RANKS: Rank[] = [
  { id: 'recruit', name: 'Recruit', icon: '\u{1F396}\uFE0F', description: 'First message sent', requirement: 'Send 1 message' },
  { id: 'operator', name: 'Operator', icon: '\u2694\uFE0F', description: 'Verified a device via QR', requirement: 'Verify 1 device' },
  { id: 'ghost', name: 'Ghost', icon: '\u{1F47B}', description: 'Used self-destruct messages', requirement: 'Send 10 disappearing messages' },
  { id: 'phantom', name: 'Phantom', icon: '\u{1F576}\uFE0F', description: 'Privacy mode master', requirement: 'Enable privacy mode for 24h+' },
  { id: 'commander', name: 'Commander', icon: '\u2B50', description: 'Created 5 rooms', requirement: 'Create 5 rooms' },
  { id: 'cipher', name: 'Cipher', icon: '\u{1F510}', description: 'Backed up encryption keys via Settings \u2192 Key Backup \u2192 Export Keys', requirement: 'Export your encryption keys once (creates a backup for other devices)' },
  { id: 'shadow', name: 'Shadow Ops', icon: '\u{1F977}', description: 'Elite agent', requirement: 'Unlock all other ranks' },
];

// ── localStorage key ──

const STORAGE_KEY = 'frame-ranks';

// ── Helpers ──

function readUnlocked(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string');
      }
    }
  } catch { /* ignore corrupt data */ }
  return [];
}

function writeUnlocked(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch { /* quota exceeded or private mode */ }
}

// ── Public API ──

/**
 * Get the list of currently unlocked rank IDs.
 */
export function getUnlockedRanks(): string[] {
  return readUnlocked();
}

/**
 * Attempt to unlock a rank. Returns true if it was newly unlocked,
 * false if already unlocked or the rank ID is invalid.
 *
 * Special case: "shadow" can only be unlocked when all other ranks
 * are already unlocked.
 */
export function unlockRank(rankId: string): boolean {
  // Validate rank ID exists
  const rankExists = RANKS.some((r) => r.id === rankId);
  if (!rankExists) return false;

  const current = readUnlocked();

  // Already unlocked
  if (current.includes(rankId)) return false;

  // Shadow Ops requires all other ranks
  if (rankId === 'shadow') {
    const otherRankIds = RANKS.filter((r) => r.id !== 'shadow').map((r) => r.id);
    const allOthersUnlocked = otherRankIds.every((id) => current.includes(id));
    if (!allOthersUnlocked) return false;
  }

  current.push(rankId);

  // Check if unlocking this rank also qualifies for Shadow Ops
  if (rankId !== 'shadow') {
    const otherRankIds = RANKS.filter((r) => r.id !== 'shadow').map((r) => r.id);
    const allOthersUnlocked = otherRankIds.every((id) => current.includes(id));
    if (allOthersUnlocked && !current.includes('shadow')) {
      current.push('shadow');
    }
  }

  writeUnlocked(current);
  return true;
}

/**
 * Get the user's current (highest) rank. Returns the most recently
 * unlocked rank that appears latest in the RANKS array.
 * Falls back to a "Civilian" placeholder if nothing is unlocked.
 */
export function getCurrentRank(): Rank {
  const unlocked = readUnlocked();
  if (unlocked.length === 0) {
    return { id: 'civilian', name: 'Civilian', icon: '\u{1F464}', description: 'No ranks earned yet', requirement: 'Start using F.R.A.M.E.' };
  }

  // Return the highest-tier unlocked rank (last match in RANKS order)
  let highest: Rank | null = null;
  for (const rank of RANKS) {
    if (unlocked.includes(rank.id)) {
      highest = rank;
    }
  }

  return highest ?? { id: 'civilian', name: 'Civilian', icon: '\u{1F464}', description: 'No ranks earned yet', requirement: 'Start using F.R.A.M.E.' };
}

/**
 * Get the overall unlock progress.
 */
export function getProgress(): { unlocked: number; total: number } {
  const unlocked = readUnlocked();
  return { unlocked: unlocked.length, total: RANKS.length };
}

/**
 * Per-achievement progress info for display.
 */
export interface AchievementProgress {
  current: number;
  target: number;
  label: string;
  met: boolean;
}

/**
 * Check localStorage signals and return progress for each achievement.
 * Also auto-unlocks any achievements whose criteria are now met.
 */
export function checkAchievements(): Record<string, AchievementProgress> {
  const progress: Record<string, AchievementProgress> = {};

  // Recruit: at least 1 message sent (we check for optimistic messages or sync)
  // We rely on the rank already being unlocked via ChatWindow send handler
  const recruitUnlocked = readUnlocked().includes('recruit');
  progress['recruit'] = { current: recruitUnlocked ? 1 : 0, target: 1, label: recruitUnlocked ? 'Message sent' : 'Send your first message', met: recruitUnlocked };

  // Operator: verified a device via QR — check for frame-device-verified:* keys
  let deviceVerifiedCount = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('frame-device-verified:') && localStorage.getItem(key) === 'true') {
        deviceVerifiedCount++;
      }
    }
  } catch { /* ignore */ }
  progress['operator'] = { current: Math.min(deviceVerifiedCount, 1), target: 1, label: deviceVerifiedCount > 0 ? 'Device verified' : 'Verify a device via QR', met: deviceVerifiedCount > 0 };
  if (deviceVerifiedCount > 0) unlockRank('operator');

  // Ghost: used self-destruct messages — check frame-consumed-once entries
  let consumedOnceCount = 0;
  try {
    const raw = localStorage.getItem('frame-consumed-once');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) consumedOnceCount = parsed.length;
    }
  } catch { /* ignore */ }
  progress['ghost'] = { current: Math.min(consumedOnceCount, 10), target: 10, label: `${Math.min(consumedOnceCount, 10)}/10 disappearing messages used`, met: consumedOnceCount >= 10 };
  if (consumedOnceCount >= 10) unlockRank('ghost');

  // Commander: created 5 rooms — count frame-room-creator:* keys
  let roomsCreatedCount = 0;
  try {
    const raw = localStorage.getItem('frame-rooms-created-count');
    if (raw) roomsCreatedCount = parseInt(raw, 10) || 0;
  } catch { /* ignore */ }
  progress['commander'] = { current: Math.min(roomsCreatedCount, 5), target: 5, label: `${Math.min(roomsCreatedCount, 5)}/5 rooms created`, met: roomsCreatedCount >= 5 };
  if (roomsCreatedCount >= 5) unlockRank('commander');

  // Cipher: backed up encryption keys
  let hasExported = false;
  try {
    hasExported = localStorage.getItem('frame-key-backup-exported') === 'true';
  } catch { /* ignore */ }
  progress['cipher'] = { current: hasExported ? 1 : 0, target: 1, label: hasExported ? 'Keys exported' : 'Export your encryption keys from Settings', met: hasExported };
  if (hasExported) unlockRank('cipher');

  // Phantom: privacy mode enabled (check PrivacyShield usage)
  let privacyEnabled = false;
  try {
    privacyEnabled = localStorage.getItem('frame-privacy-mode-used') === 'true';
  } catch { /* ignore */ }
  progress['phantom'] = { current: privacyEnabled ? 1 : 0, target: 1, label: privacyEnabled ? 'Privacy mode activated' : 'Enable privacy mode in the app', met: privacyEnabled };
  if (privacyEnabled) unlockRank('phantom');

  // Shadow: all other ranks unlocked
  const allOthersMet = ['recruit', 'operator', 'ghost', 'phantom', 'commander', 'cipher'].every(id => readUnlocked().includes(id));
  progress['shadow'] = { current: readUnlocked().filter(id => id !== 'shadow').length, target: 6, label: allOthersMet ? 'All ranks unlocked' : `${readUnlocked().filter(id => id !== 'shadow').length}/6 ranks unlocked`, met: allOthersMet };
  if (allOthersMet) unlockRank('shadow');

  return progress;
}

/**
 * Increment the rooms-created counter. Called when user creates a room.
 */
export function incrementRoomsCreated(): void {
  try {
    const current = parseInt(localStorage.getItem('frame-rooms-created-count') || '0', 10);
    localStorage.setItem('frame-rooms-created-count', String(current + 1));
  } catch { /* ignore */ }
}

/**
 * Mark privacy mode as used.
 */
export function markPrivacyModeUsed(): void {
  try {
    localStorage.setItem('frame-privacy-mode-used', 'true');
  } catch { /* ignore */ }
}
