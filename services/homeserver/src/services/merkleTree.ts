/**
 * Merkle Tree service for F.R.A.M.E. Key Transparency.
 *
 * Provides an append-only Merkle tree over the key transparency log.
 * Each leaf is a SHA-256 hash of a user's public key. When a new key
 * is added, the tree is rebuilt from all existing leaves plus the new
 * one, and the root + proof are persisted in the database.
 *
 * SECURITY: Never log raw key material. Only hashes are stored.
 */

import crypto from 'crypto';
import { pool } from '../db/pool';
import type { MerkleProof, MerkleProofNode } from '@frame/shared/keys';

// ── Hashing ──

/**
 * SHA-256 hash of the concatenation of two hex strings.
 * Internal nodes are H(left || right) to prevent second-preimage attacks.
 */
function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hashPair(left: string, right: string): string {
  return sha256(left + right);
}

// ── Tree construction ──

/**
 * Build a complete Merkle tree from an array of leaf hashes.
 *
 * Returns a 2D array where `tree[0]` is the leaf layer and
 * `tree[tree.length - 1]` is the root layer (single element).
 *
 * If the number of nodes at any level is odd, the last node is
 * duplicated so every pair can be hashed.
 */
export function buildMerkleTree(leaves: string[]): string[][] {
  if (leaves.length === 0) {
    return [['']];
  }

  const tree: string[][] = [leaves.slice()];
  let currentLevel = tree[0];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1] ?? currentLevel[i]; // duplicate if odd
      nextLevel.push(hashPair(left, right));
    }

    tree.push(nextLevel);
    currentLevel = nextLevel;
  }

  return tree;
}

/**
 * Get the Merkle root from a set of leaves.
 */
export function getMerkleRoot(leaves: string[]): string {
  const tree = buildMerkleTree(leaves);
  return tree[tree.length - 1][0];
}

/**
 * Generate a Merkle proof (authentication path) for the leaf at
 * `leafIndex`. Each node in the path records its hash and whether
 * it is the left or right sibling.
 */
export function generateMerkleProof(
  leaves: string[],
  leafIndex: number,
): MerkleProofNode[] {
  if (leafIndex < 0 || leafIndex >= leaves.length) {
    throw new Error('Leaf index out of range');
  }

  const tree = buildMerkleTree(leaves);
  const proof: MerkleProofNode[] = [];
  let idx = leafIndex;

  for (let level = 0; level < tree.length - 1; level++) {
    const layer = tree[level];
    const isLeft = idx % 2 === 0;
    const siblingIdx = isLeft ? idx + 1 : idx - 1;

    // If sibling doesn't exist (odd layer), it's a duplicate of this node
    const siblingHash =
      siblingIdx < layer.length ? layer[siblingIdx] : layer[idx];

    proof.push({
      position: isLeft ? 'right' : 'left',
      hash: siblingHash,
    });

    idx = Math.floor(idx / 2);
  }

  return proof;
}

// ── Database operations ──

/**
 * Fetch all existing leaf hashes from the transparency log, ordered
 * by insertion time. This is the canonical leaf ordering for the tree.
 */
async function getAllLeaves(): Promise<string[]> {
  const result = await pool.query(
    'SELECT key_hash FROM key_transparency_log ORDER BY log_id ASC',
  );
  return result.rows.map((row: { key_hash: string }) => row.key_hash);
}

/**
 * Add a new key to the transparency log.
 *
 * 1. Hash the public key with SHA-256 to get the leaf hash.
 * 2. Fetch all existing leaves and append the new one.
 * 3. Build the Merkle tree and compute root + proof.
 * 4. Insert the log entry with root and proof.
 *
 * The tree is append-only: existing entries are never modified.
 */
export async function addKeyToLog(
  userId: string,
  publicKeyHash: string,
): Promise<MerkleProof> {
  const keyHash = sha256(publicKeyHash);

  // Fetch existing leaves and append new one
  const existingLeaves = await getAllLeaves();
  const allLeaves = [...existingLeaves, keyHash];
  const leafIndex = allLeaves.length - 1;

  // Build tree
  const root = getMerkleRoot(allLeaves);
  const proofPath = generateMerkleProof(allLeaves, leafIndex);

  // Persist to database
  const result = await pool.query(
    `INSERT INTO key_transparency_log (user_id, key_hash, merkle_root, merkle_proof, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING created_at`,
    [userId, keyHash, root, JSON.stringify(proofPath)],
  );

  return {
    userId,
    keyHash,
    proofPath,
    root,
    timestamp: result.rows[0].created_at.toISOString(),
  };
}

/**
 * Fetch the latest Merkle proof for a user from the transparency log.
 *
 * Returns `null` if no entry exists for this user.
 */
export async function getProofForUser(
  userId: string,
): Promise<MerkleProof | null> {
  const result = await pool.query(
    `SELECT user_id, key_hash, merkle_root, merkle_proof, created_at
     FROM key_transparency_log
     WHERE user_id = $1
     ORDER BY log_id DESC
     LIMIT 1`,
    [userId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    userId: row.user_id,
    keyHash: row.key_hash,
    proofPath: row.merkle_proof as MerkleProofNode[],
    root: row.merkle_root,
    timestamp: row.created_at.toISOString(),
  };
}
