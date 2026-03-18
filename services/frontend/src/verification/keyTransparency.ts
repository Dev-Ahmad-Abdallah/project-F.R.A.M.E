/**
 * Client-side Merkle proof verification for F.R.A.M.E. Key Transparency.
 *
 * Verifies that a user's public key is included in the server's
 * append-only transparency log by walking the Merkle proof path
 * from the leaf hash up to the claimed root.
 *
 * Uses Web Crypto API (SubtleCrypto) for SHA-256 — never Node crypto.
 *
 * SECURITY: Never log or expose raw key material.
 */

import type { MerkleProof } from '@frame/shared/keys';
import { apiRequest } from '../api/client';
import { getEncrypted, setEncrypted } from '../storage/secureStorage';

// ── Hashing (Web Crypto) ──

const encoder = new TextEncoder();

/**
 * SHA-256 hash of a string, returned as lowercase hex.
 */
async function sha256(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash a pair of hex strings: H(left || right).
 */
async function hashPair(left: string, right: string): Promise<string> {
  return sha256(left + right);
}

// ── Proof verification ──

/**
 * Verify a Merkle proof by walking from the leaf hash up to the root.
 *
 * For each proof node, the current hash is combined with the sibling
 * hash according to the sibling's position (left or right), producing
 * the parent hash. The final computed root must match the claimed root.
 *
 * @param proof - The Merkle proof returned by the server
 * @param claimedPublicKey - The public key hash to verify inclusion for
 * @returns `true` if the proof is valid and the key is in the tree
 */
export async function verifyMerkleProof(
  proof: MerkleProof,
  claimedPublicKey: string,
): Promise<boolean> {
  // The leaf is SHA-256 of the public key hash (matches server-side addKeyToLog)
  let currentHash = await sha256(claimedPublicKey);

  // Verify the leaf hash matches what the server claims
  if (currentHash !== proof.keyHash) {
    return false;
  }

  // Walk up the proof path
  for (const node of proof.proofPath) {
    if (node.position === 'left') {
      // Sibling is on the left, current is on the right
      currentHash = await hashPair(node.hash, currentHash);
    } else {
      // Sibling is on the right, current is on the left
      currentHash = await hashPair(currentHash, node.hash);
    }
  }

  // The computed root must match the claimed root
  return currentHash === proof.root;
}

// ── Key fetching and verification ──

export interface VerifiedKeyResult {
  verified: boolean;
  proof: MerkleProof | null;
  rootChanged: boolean;
}

/**
 * Fetch a user's key bundle and Merkle proof from the server,
 * verify the proof, and cache the result in secure storage.
 *
 * Also detects if the Merkle root has changed since the last
 * verification (potential log manipulation or key change).
 */
export async function fetchAndVerifyKey(
  userId: string,
): Promise<VerifiedKeyResult> {
  // Fetch the Merkle proof from the transparency endpoint
  const proof = await apiRequest<MerkleProof>(
    `/keys/transparency/${encodeURIComponent(userId)}`,
  );

  if (!proof || !proof.keyHash) {
    return { verified: false, proof: null, rootChanged: false };
  }

  // Fetch the stored root for comparison
  const storedRoot = await getEncrypted<string>(
    'verification',
    `merkle-root:${userId}`,
  );

  const rootChanged = storedRoot != null && storedRoot !== proof.root;

  // Verify the proof by walking the tree (use the keyHash as the claimed public key hash)
  // We need the original public key hash that was passed to addKeyToLog.
  // Since we can't recover it from the proof alone, we fetch the key bundle.
  const bundle = await apiRequest<{ identityKey: string }>(
    `/keys/${encodeURIComponent(userId)}`,
  );

  const verified = await verifyMerkleProof(proof, bundle.identityKey);

  if (verified) {
    // Cache the verified root and proof in secure storage
    await setEncrypted('verification', `merkle-root:${userId}`, proof.root);
    await setEncrypted('verification', `merkle-proof:${userId}`, proof);
  }

  return { verified, proof, rootChanged };
}

/**
 * Compare a previously stored Merkle root with a newly received one.
 *
 * Returns `true` if they match (log has not been manipulated).
 * Returns `false` if they differ (possible tampering or key rotation).
 */
export function compareRoots(
  storedRoot: string,
  newRoot: string,
): boolean {
  return storedRoot === newRoot;
}
