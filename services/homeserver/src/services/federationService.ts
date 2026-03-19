import crypto from 'crypto';
import { getConfig, getFederationPeers } from '../config';
import { insertEvent, createDeliveryEntries } from '../db/queries/events';
import { getRoomMembers, isRoomMember } from '../db/queries/rooms';
import { pool } from '../db/pool';
import { redisClient } from '../redis/client';
import { ApiError } from '../middleware/errorHandler';
import type { FederationEvent, ServerDiscovery } from '@frame/shared/federation';

const config = getConfig();

// ── Signing Key Management ──

/**
 * Parse the Ed25519 private key from the base64-encoded FEDERATION_SIGNING_KEY env var.
 * The key is expected to be a base64-encoded PKCS8 DER Ed25519 private key.
 */
function getSigningPrivateKey(): crypto.KeyObject {
  const keyBase64 = config.FEDERATION_SIGNING_KEY;
  const keyBuffer = Buffer.from(keyBase64, 'base64');

  // Support both raw 32-byte seed and PKCS8 DER formats
  if (keyBuffer.length === 32) {
    // Raw 32-byte Ed25519 seed — wrap in PKCS8 DER envelope
    const pkcs8Prefix = Buffer.from(
      '302e020100300506032b657004220420',
      'hex'
    );
    const pkcs8Der = Buffer.concat([pkcs8Prefix, keyBuffer]);
    return crypto.createPrivateKey({
      key: pkcs8Der,
      format: 'der',
      type: 'pkcs8',
    });
  }

  return crypto.createPrivateKey({
    key: keyBuffer,
    format: 'der',
    type: 'pkcs8',
  });
}

/**
 * Derive the public key from the private key for publishing to peers.
 */
function getSigningPublicKey(): crypto.KeyObject {
  return crypto.createPublicKey(getSigningPrivateKey());
}

/**
 * Get the public key as a base64 string for inclusion in discovery responses.
 */
export function getPublicKeyBase64(): string {
  const pubKey = getSigningPublicKey();
  const raw = pubKey.export({ type: 'spki', format: 'der' });
  return Buffer.from(raw).toString('base64');
}

// ── Key ID ──

/** Stable key identifier for this server's current signing key. */
function getKeyId(): string {
  return `ed25519:${config.HOMESERVER_DOMAIN}`;
}

// ── Canonical JSON ──

/**
 * Produce a canonical JSON encoding for signature verification.
 * Keys are sorted lexicographically at every nesting level.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number') {
    // NaN and Infinity are not valid JSON — coerce to null for safety
    if (!Number.isFinite(obj)) return 'null';
    return String(obj);
  }
  if (typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    // Arrays preserve undefined elements as null (matching JSON.stringify behaviour)
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    // Omit keys whose value is undefined (matching JSON.stringify behaviour)
    const pairs = keys
      // eslint-disable-next-line security/detect-object-injection -- k comes from Object.keys(record)
      .filter((k) => record[k] !== undefined)
      // eslint-disable-next-line security/detect-object-injection -- k comes from Object.keys(record)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
    return '{' + pairs.join(',') + '}';
  }
  return 'null';
}

/**
 * Build the signable payload from an event — everything except the `signatures` field.
 */
function signablePayload(event: FederationEvent): string {
  const { signatures: _signatures, ...rest } = event;
  return canonicalJson(rest);
}

// ── Core Federation Functions ──

/**
 * Sign a federation event with this server's Ed25519 key.
 * Adds the signature to event.signatures under this server's domain.
 */
export function signEvent(event: FederationEvent): FederationEvent {
  const payload = signablePayload(event);
  const privateKey = getSigningPrivateKey();

  const signature = crypto.sign(null, Buffer.from(payload), privateKey);
  const signatureBase64 = signature.toString('base64');

  const keyId = getKeyId();

  return {
    ...event,
    signatures: {
      ...event.signatures,
      [config.HOMESERVER_DOMAIN]: {
        [keyId]: signatureBase64,
      },
    },
  };
}

/**
 * Verify that an incoming event bears a valid signature from the claimed origin server.
 * Fetches the peer's public key via well-known discovery.
 */
export async function verifyEventSignature(
  event: FederationEvent,
  peerDomain: string
): Promise<boolean> {
  const sigMap = new Map(Object.entries(event.signatures));
  const peerSigs = sigMap.get(peerDomain);
  if (!peerSigs) {
    return false;
  }

  // Get the peer's public key
  const peerPublicKey = await fetchPeerPublicKey(peerDomain);
  if (!peerPublicKey) {
    return false;
  }

  const payload = signablePayload(event);

  // Verify against any key ID from this peer (take the first)
  const sigEntries = Object.values(peerSigs);
  if (sigEntries.length === 0) {
    return false;
  }

  for (const sigBase64 of sigEntries) {
    try {
      const signatureBuffer = Buffer.from(sigBase64, 'base64');
      const isValid = crypto.verify(
        null,
        Buffer.from(payload),
        peerPublicKey,
        signatureBuffer
      );
      if (isValid) return true;
    } catch {
      // Skip malformed signatures
      continue;
    }
  }

  return false;
}

// ── Peer Public Key Cache ──

const peerPublicKeyCache = new Map<string, { key: crypto.KeyObject; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchPeerPublicKey(domain: string): Promise<crypto.KeyObject | null> {
  // Check cache first
  const cached = peerPublicKeyCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  try {
    const discovery = await discoverPeer(domain);
    if (!discovery) return null;

    const pubKeyDer = Buffer.from(discovery['frame.server'].publicKey, 'base64');
    const publicKey = crypto.createPublicKey({
      key: pubKeyDer,
      format: 'der',
      type: 'spki',
    });

    peerPublicKeyCache.set(domain, {
      key: publicKey,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return publicKey;
  } catch (err) {
    console.error(`[Federation] Failed to fetch public key for ${domain}:`, err);
    return null;
  }
}

// ── Peer Discovery ──

/**
 * Fetch /.well-known/frame/server from a peer domain.
 */
export async function discoverPeer(domain: string): Promise<ServerDiscovery | null> {
  try {
    const url = `https://${domain}/.well-known/frame/server`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(`[Federation] Discovery failed for ${domain}: HTTP ${String(response.status)}`);
      return null;
    }

    const data = (await response.json()) as ServerDiscovery;
    return data;
  } catch (err) {
    console.error(`[Federation] Discovery error for ${domain}:`, err);
    return null;
  }
}

// ── Peer Trust ──

/**
 * Check if a domain is in the configured FEDERATION_PEERS list.
 */
export function isPeerTrusted(domain: string): boolean {
  const peers = getFederationPeers();
  return peers.includes(domain);
}

// ── Event Relay ──

/**
 * Sign and relay an event to a specific peer server via HTTPS POST.
 */
export async function relayEventToPeer(
  event: FederationEvent,
  peerDomain: string
): Promise<boolean> {
  if (!isPeerTrusted(peerDomain)) {
    console.warn(`[Federation] Refusing to relay to untrusted peer: ${peerDomain}`);
    return false;
  }

  const signedEvent = signEvent(event);

  try {
    const discovery = await discoverPeer(peerDomain);
    if (!discovery) {
      console.error(`[Federation] Cannot discover peer ${peerDomain}, relay failed`);
      return false;
    }

    const { host, port } = discovery['frame.server'];
    const url = `https://${host}:${String(port)}/federation/send`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [signedEvent] }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const respBody = await response.text();
      console.error(`[Federation] Relay to ${peerDomain} failed: ${String(response.status)} ${respBody}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[Federation] Relay error to ${peerDomain}:`, err);
    return false;
  }
}

/**
 * Relay an event to all trusted peers with failure tracking.
 *
 * TODO: Implement a persistent retry queue — store failed relay attempts in
 * a `federation_relay_queue` table and process them on a periodic timer
 * (e.g., exponential backoff: 5s, 30s, 2m, 10m, 1h). This would prevent
 * message loss when peers are temporarily unreachable.
 */
export async function relayEventToAllPeers(event: FederationEvent): Promise<void> {
  const peers = getFederationPeers();
  const results = await Promise.allSettled(
    peers.map((peer) => relayEventToPeer(event, peer))
  );

  const failedPeers: string[] = [];

  results.forEach((result, i) => {
    // eslint-disable-next-line security/detect-object-injection -- i is a safe numeric index from forEach
    const peerName = peers[i];
    if (result.status === 'rejected') {
      console.error(
        `[Federation] Relay to ${peerName} threw (eventId=${event.eventId}, roomId=${event.roomId}):`,
        result.reason
      );
      failedPeers.push(peerName);
    } else if (!result.value) {
      console.warn(
        `[Federation] Relay to ${peerName} returned failure (eventId=${event.eventId}, roomId=${event.roomId})`
      );
      failedPeers.push(peerName);
    }
  });

  if (failedPeers.length > 0) {
    // TODO: Persist to federation_relay_queue table for retry instead of just logging
    console.error(
      `[Federation] Failed to relay event ${event.eventId} to ${String(failedPeers.length)}/${String(peers.length)} peers: ${failedPeers.join(', ')}`
    );
  }
}

// ── Incoming Event Handling ──

/**
 * Handle an incoming federation event from a peer server.
 * Validates signature, checks trust, stores event, and fans out to local devices.
 */
export async function handleIncomingFederationEvent(
  event: FederationEvent
): Promise<{ eventId: string; sequenceId: number }> {
  const origin = event.origin;

  // 1. Check trust
  if (!isPeerTrusted(origin)) {
    throw new ApiError(403, 'M_FORBIDDEN', `Origin server ${origin} is not a trusted peer`);
  }

  // 2. Verify signature
  const signatureValid = await verifyEventSignature(event, origin);
  if (!signatureValid) {
    throw new ApiError(403, 'M_UNAUTHORIZED', `Invalid signature from origin server ${origin}`);
  }

  // 3. Validate that the sender is a member of the target room
  const senderIsMember = await isRoomMember(event.roomId, event.sender);
  if (!senderIsMember) {
    throw new ApiError(
      403,
      'M_FORBIDDEN',
      `Sender ${event.sender} is not a member of room ${event.roomId}`
    );
  }

  // 4. Check for replay: if event already exists, return it instead of inserting a duplicate
  const existingEvent = await pool.query<{ event_id: string; sequence_id: number }>(
    'SELECT event_id, sequence_id FROM events WHERE event_id = $1',
    [event.eventId]
  );
  if (existingEvent.rows.length > 0) {
    return {
      eventId: existingEvent.rows[0].event_id,
      sequenceId: existingEvent.rows[0].sequence_id,
    };
  }

  // 5. Store event in local database
  const stored = await insertEvent(
    event.eventId,
    event.roomId,
    event.sender,
    '', // sender_device_id not included in federation events
    event.eventType,
    event.content,
    event.origin,
    new Date(event.originServerTs)
  );

  // 6. Fan-out to local recipient devices (batch query instead of N+1)
  const members = await getRoomMembers(event.roomId);
  const localMemberIds = members
    .filter((m) => m.user_id.endsWith(`:${config.HOMESERVER_DOMAIN}`))
    .map((m) => m.user_id);

  let localDeviceIds: string[] = [];
  if (localMemberIds.length > 0) {
    const deviceResult = await pool.query<{ device_id: string }>(
      'SELECT device_id FROM devices WHERE user_id = ANY($1::text[])',
      [localMemberIds]
    );
    localDeviceIds = deviceResult.rows.map((r) => r.device_id);
  }

  if (localDeviceIds.length > 0) {
    await createDeliveryEntries(event.eventId, localDeviceIds);

    // Notify local devices via Redis pub/sub in parallel
    const notification = JSON.stringify({
      eventId: event.eventId,
      roomId: event.roomId,
      sequenceId: stored.sequence_id,
    });
    await Promise.all(
      localDeviceIds.map((deviceId) =>
        redisClient.publish(`device:${deviceId}`, notification)
      )
    );
  }

  return {
    eventId: stored.event_id,
    sequenceId: stored.sequence_id,
  };
}
