/**
 * Federation Service unit tests.
 * All external dependencies (DB pool, Redis, config, room/event queries) are mocked.
 */

const mockPoolQuery = jest.fn();
const mockPoolConnect = jest.fn();

jest.mock('../../src/db/pool', () => ({
  pool: {
    query: (...args: any[]) => mockPoolQuery(...args),
    connect: (...args: any[]) => mockPoolConnect(...args),
  },
}));

const mockRedisPublish = jest.fn();

jest.mock('../../src/redis/client', () => ({
  redisClient: {
    publish: (...args: any[]) => mockRedisPublish(...args),
  },
}));

const mockInsertEvent = jest.fn();
const mockCreateDeliveryEntries = jest.fn();

jest.mock('../../src/db/queries/events', () => ({
  insertEvent: (...args: any[]) => mockInsertEvent(...args),
  createDeliveryEntries: (...args: any[]) => mockCreateDeliveryEntries(...args),
}));

const mockGetRoomMembers = jest.fn();
const mockIsRoomMember = jest.fn();

jest.mock('../../src/db/queries/rooms', () => ({
  getRoomMembers: (...args: any[]) => mockGetRoomMembers(...args),
  isRoomMember: (...args: any[]) => mockIsRoomMember(...args),
}));

jest.mock('../../src/config', () => ({
  getConfig: () => ({
    HOMESERVER_DOMAIN: 'test.frame.local',
    JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
    BCRYPT_SALT_ROUNDS: 10,
    FEDERATION_SIGNING_KEY: 'MC4CAQAwBQYDK2VwBCIEIGdBVe5oCIJnClyXiPQC7bLBxennMnhBsxqm+YK6kbKc',
    FEDERATION_PEERS: 'peer1.example.com,peer2.example.com',
    DATABASE_URL: 'postgres://localhost/test',
    REDIS_URL: 'redis://localhost',
    PORT: 3000,
    NODE_ENV: 'test',
    CORS_ORIGINS: '',
    DB_SSL_REJECT_UNAUTHORIZED: false,
  }),
  getFederationPeers: () => ['peer1.example.com', 'peer2.example.com'],
}));

import { isPeerTrusted, signEvent, handleIncomingFederationEvent } from '../../src/services/federationService';
import type { FederationEvent } from '@frame/shared/federation';

beforeEach(() => {
  jest.clearAllMocks();
});

// ── isPeerTrusted() ──

describe('isPeerTrusted', () => {
  it('returns true for configured peers', () => {
    expect(isPeerTrusted('peer1.example.com')).toBe(true);
    expect(isPeerTrusted('peer2.example.com')).toBe(true);
  });

  it('returns false for unknown peers', () => {
    expect(isPeerTrusted('unknown.example.com')).toBe(false);
    expect(isPeerTrusted('evil.attacker.com')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isPeerTrusted('')).toBe(false);
  });

  it('returns false for partial domain match', () => {
    // Should not match substrings
    expect(isPeerTrusted('peer1.example')).toBe(false);
    expect(isPeerTrusted('example.com')).toBe(false);
  });
});

// ── signEvent() ──

describe('signEvent', () => {
  it('adds signature under this server domain', () => {
    const event: FederationEvent = {
      origin: 'test.frame.local',
      originServerTs: Date.now(),
      eventId: '$test-event-id',
      roomId: '!room:test.frame.local',
      sender: '@alice:test.frame.local',
      eventType: 'm.room.message',
      content: { body: 'hello' },
      signatures: {},
    };

    const signed = signEvent(event);

    // Should have signatures for this server
    expect(signed.signatures['test.frame.local']).toBeDefined();
    const serverSigs = signed.signatures['test.frame.local'];
    expect(serverSigs).toBeDefined();

    // Should have a key ID entry with a base64 signature
    const keyId = Object.keys(serverSigs)[0];
    expect(keyId).toMatch(/^ed25519:/);
    const sig = serverSigs[keyId];
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(0);
  });

  it('preserves existing signatures from other servers', () => {
    const event: FederationEvent = {
      origin: 'other.server.com',
      originServerTs: Date.now(),
      eventId: '$test-event-id',
      roomId: '!room:other.server.com',
      sender: '@bob:other.server.com',
      eventType: 'm.room.message',
      content: { body: 'federated message' },
      signatures: {
        'other.server.com': {
          'ed25519:other.server.com': 'existing-signature-base64',
        },
      },
    };

    const signed = signEvent(event);

    // Should preserve the existing signature
    expect(signed.signatures['other.server.com']).toEqual({
      'ed25519:other.server.com': 'existing-signature-base64',
    });
    // Should also add this server's signature
    expect(signed.signatures['test.frame.local']).toBeDefined();
  });

  it('produces deterministic signatures for the same event', () => {
    const event: FederationEvent = {
      origin: 'test.frame.local',
      originServerTs: 1700000000000,
      eventId: '$deterministic-test',
      roomId: '!room:test.frame.local',
      sender: '@alice:test.frame.local',
      eventType: 'm.room.message',
      content: { body: 'deterministic' },
      signatures: {},
    };

    const signed1 = signEvent(event);
    const signed2 = signEvent(event);

    const keyId1 = Object.keys(signed1.signatures['test.frame.local'])[0];
    const keyId2 = Object.keys(signed2.signatures['test.frame.local'])[0];

    // Ed25519 signatures are deterministic
    expect(signed1.signatures['test.frame.local'][keyId1])
      .toBe(signed2.signatures['test.frame.local'][keyId2]);
  });
});

// ── handleIncomingFederationEvent() ──

describe('handleIncomingFederationEvent', () => {
  it('rejects events from untrusted origin', async () => {
    const event: FederationEvent = {
      origin: 'evil.attacker.com',
      originServerTs: Date.now(),
      eventId: '$evil-event',
      roomId: '!room:test.frame.local',
      sender: '@hacker:evil.attacker.com',
      eventType: 'm.room.message',
      content: { body: 'malicious' },
      signatures: {},
    };

    await expect(handleIncomingFederationEvent(event)).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    // Should not attempt to store the event
    expect(mockInsertEvent).not.toHaveBeenCalled();
  });

  it('rejects events with untrusted origin even if signatures exist', async () => {
    const event: FederationEvent = {
      origin: 'unknown-server.com',
      originServerTs: Date.now(),
      eventId: '$unknown-event',
      roomId: '!room:test.frame.local',
      sender: '@user:unknown-server.com',
      eventType: 'm.room.message',
      content: { body: 'test' },
      signatures: {
        'unknown-server.com': {
          'ed25519:unknown-server.com': 'some-fake-signature',
        },
      },
    };

    await expect(handleIncomingFederationEvent(event)).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    expect(mockInsertEvent).not.toHaveBeenCalled();
    expect(mockGetRoomMembers).not.toHaveBeenCalled();
  });
});
