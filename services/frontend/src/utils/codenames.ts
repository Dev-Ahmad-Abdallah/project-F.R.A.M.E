/**
 * Tactical Mission Codenames for F.R.A.M.E.
 *
 * Generates deterministic military-style codenames from seeds,
 * and random mission codes for anonymous rooms.
 */

const ADJECTIVES = [
  'Shadow', 'Ghost', 'Neon', 'Arctic', 'Phantom', 'Silent', 'Iron',
  'Crimson', 'Stealth', 'Cipher', 'Dark', 'Echo', 'Frost', 'Omega',
  'Rogue', 'Storm', 'Venom', 'Zero', 'Apex', 'Blitz',
];

const NOUNS = [
  'Viper', 'Falcon', 'Phoenix', 'Wolf', 'Hawk', 'Cobra', 'Panther',
  'Eagle', 'Tiger', 'Raven', 'Dragon', 'Serpent', 'Jaguar', 'Lynx',
  'Raptor', 'Mantis', 'Scorpion', 'Hydra', 'Griffin', 'Wraith',
];

/**
 * Generate a deterministic codename from a seed string (e.g., hash of userId + roomId).
 * Always returns the same codename for the same seed.
 */
export function generateCodename(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const adj = ADJECTIVES[Math.abs(hash) % ADJECTIVES.length];
  const noun = NOUNS[Math.abs(hash >> 8) % NOUNS.length];
  return `${adj} ${noun}`;
}

/**
 * Generate a random 4-character mission code in the format: letter-digit-letter-digit.
 * Uses letters excluding I and O (to avoid confusion with 1 and 0).
 * Ensures the two digits are non-consecutive (not equal and not adjacent).
 */
export function generateMissionCode(): string {
  const alpha = 'ABCDEFGH' + 'JKLMNPQRSTUVWXYZ'; // I, O removed for readability
  const letters = alpha;
  const l1 = letters[Math.floor(Math.random() * letters.length)];
  const d1 = Math.floor(Math.random() * 10);
  const l2 = letters[Math.floor(Math.random() * letters.length)];
  let d2 = Math.floor(Math.random() * 10);
  while (d2 === d1 || Math.abs(d2 - d1) === 1) d2 = Math.floor(Math.random() * 10);
  return `${l1}${d1}${l2}${d2}`;
}

/**
 * Generate a full mission label: "MISSION: Shadow Viper [A7B2]"
 * Uses the roomId as the seed for the codename, and generates a random mission code.
 */
export function generateMissionLabel(roomId: string): string {
  const codename = generateCodename(roomId);
  const code = generateMissionCode();
  return `MISSION: ${codename} [${code}]`;
}
