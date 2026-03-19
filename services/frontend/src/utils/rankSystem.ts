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
  { id: 'cipher', name: 'Cipher', icon: '\u{1F510}', description: 'Backed up encryption keys', requirement: 'Export keys once' },
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
