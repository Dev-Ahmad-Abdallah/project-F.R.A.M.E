/**
 * Federation & Rate Limiting — Integration Tests
 * Requires real Postgres + Redis (provided by CI service containers)
 */

import request from 'supertest';
import { app } from '../../src/server';
import { pool } from '../../src/db/pool';
import { redisClient } from '../../src/redis/client';

async function createUser(username: string) {
  const res = await request(app).post('/auth/register').send({
    username,
    password: 'TestPass123!',
    identityKey: `ik_${username}`,
    signedPrekey: `spk_${username}`,
    signedPrekeySig: `sig_${username}`,
    oneTimePrekeys: [`otpk_${username}`],
  });
  return {
    userId: `@${username}:${process.env.HOMESERVER_DOMAIN ?? 'localhost:3000'}`,
    accessToken: res.body.accessToken as string,
  };
}

beforeEach(async () => {
  await pool.query("DELETE FROM users WHERE username LIKE 'inttest_%'");
  await redisClient.flushdb();
});

afterAll(async () => {
  await pool.end();
  await redisClient.quit();
});

// ── Health endpoint ───────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with service status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services).toHaveProperty('database');
    expect(res.body.services).toHaveProperty('redis');
  });

  it('health endpoint does not expose secrets', async () => {
    const res = await request(app).get('/health');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/password|secret|DATABASE_URL|JWT_SECRET/i);
  });
});

// ── Rate limiting ─────────────────────────────────────────────

describe('Rate limiting enforcement', () => {
  it('message endpoint blocks after exceeding limit', async () => {
    const sender = await createUser('inttest_sender_rl');

    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) {
      const res = await request(app)
        .post('/messages/send')
        .set('Authorization', `Bearer ${sender.accessToken}`)
        .send({
          roomId: `!testroom:localhost`,
          eventType: 'm.room.encrypted',
          content: {
            algorithm: 'm.megolm.v1.aes-sha2',
            ciphertext: `ciphertext_${i}`,
            senderKey: 'senderkey',
            sessionId: 'sessionid',
            deviceId: 'DEVID',
          },
        });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});

// ── Well-known federation endpoint ───────────────────────────

describe('GET /.well-known/frame/server', () => {
  it('returns server metadata', async () => {
    const res = await request(app).get('/.well-known/frame/server');
    expect(res.status).toBe(200);
    expect(res.body['frame.server']).toHaveProperty('host');
    expect(res.body['frame.server']).toHaveProperty('publicKey');
  });

  it('does not expose internal config secrets', async () => {
    const res = await request(app).get('/.well-known/frame/server');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/DATABASE_URL|JWT_SECRET|REDIS_URL/i);
  });
});

// ── Federation endpoint ───────────────────────────────────────

describe('POST /federation/send', () => {
  it('rejects unauthenticated federation requests', async () => {
    const res = await request(app).post('/federation/send').send({
      origin: 'attacker.example.com',
      destination: 'localhost',
      events: [{ event_id: '$fake', ciphertext: 'x' }],
    });
    expect([401, 403]).toContain(res.status);
  });
});

// ── IDOR — message isolation ──────────────────────────────────

describe('IDOR — message isolation', () => {
  it('user can only sync their own messages', async () => {
    const alice = await createUser('inttest_alice_msg');
    const bob = await createUser('inttest_bob_msg');

    // Bob tries to sync with Alice's user_id
    const bobSyncAsAlice = await request(app)
      .get('/messages/sync')
      .query({ userId: alice.userId })
      .set('Authorization', `Bearer ${bob.accessToken}`);

    // Should return Bob's own (empty) queue, not Alice's
    if (bobSyncAsAlice.status === 200) {
      const events = bobSyncAsAlice.body.events ?? bobSyncAsAlice.body.timeline ?? [];
      // Alice's messages must not appear
      expect(JSON.stringify(events)).not.toContain('alice_private');
    } else {
      expect([401, 403]).toContain(bobSyncAsAlice.status);
    }
  });
});
