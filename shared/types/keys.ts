// ── Key Bundle ──

export interface KeyBundle {
  userId: string;
  deviceId: string;
  identityKey: string;
  signedPrekey: string;
  signedPrekeySig: string;
  oneTimePrekeys: string[];
}

export interface KeyUploadRequest {
  oneTimePrekeys: string[];
  signedPrekey?: string;
  signedPrekeySig?: string;
}

// ── Key Transparency ──

export interface MerkleProof {
  userId: string;
  keyHash: string;
  proofPath: MerkleProofNode[];
  root: string;
  timestamp: string;
}

export interface MerkleProofNode {
  position: 'left' | 'right';
  hash: string;
}

// ── Key Transparency Log Entry ──

export interface KeyTransparencyEntry {
  logId: number;
  userId: string;
  keyHash: string;
  merkleRoot: string;
  createdAt: string;
}

// ── Fingerprint / Safety Number ──

export interface Fingerprint {
  userId: string;
  deviceId: string;
  fingerprintHex: string;
  fingerprintDisplay: string;
}
