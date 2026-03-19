/**
 * Attack Simulation Tests
 * Validates defences from the F.R.A.M.E. threat model (Phase 2, Section 4)
 */

import request from 'supertest';
import { app } from '../../src/server';
import { pool } from '../../src/db/pool';
import { redisClient } from '../../src/redis/client';

beforeEach(async () => {
  await pool.query("DELETE FROM users WHERE username LIKE 'attack_%'");
  await redisClient.flushdb();
});

afterAll(async () => {
  await pool.end();
  await redisClient.quit();
});

// ── SQL Injection ─────────────────────────────────────────────

describe('SQL Injection prevention', () => {
  const sqlPayloads = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "' UNION SELECT username, password_hash FROM users --",
    "admin'--",
    "') OR ('1'='1",
  ];

  sqlPayloads.forEach((payload) => {
    it(`blocks injection in login username: ${payload.slice(0, 30)}`, async () => {
      const res = await request(app).post('/auth/login')
        .send({ username: payload, password: 'anything' });
      expect(res.status).not.toBe(200);
      // Must not expose DB internals
      expect(JSON.stringify(res.body)).not.toMatch(
        /postgresql|sqlite|syntax error|relation|column/i
      );
    });
  });
});

// ── Username validation (Zod regex blocks injection at register) ──

describe('Register input validation', () => {
  const invalidUsernames = [
    { input: '<script>alert(1)</script>', desc: 'XSS in username' },
    { input: "'; DROP TABLE--", desc: 'SQL in username' },
    { input: '../../../etc/passwd', desc: 'Path traversal in username' },
    { input: 'a b c', desc: 'Spaces in username' },
  ];

  invalidUsernames.forEach(({ input, desc }) => {
    it(`rejects: ${desc}`, async () => {
      const res = await request(app).post('/auth/register').send({
        username: input,
        password: 'TestPass123!',
        identityKey: 'ik',
        signedPrekey: 'spk',
        signedPrekeySig: 'sig',
        oneTimePrekeys: ['otpk'],
      });
      expect(res.status).toBe(400);
    });
  });
});

// ── Brute force lockout ───────────────────────────────────────

describe('Brute force mitigation', () => {
  it('blocks correct password after rate limit breach', async () => {
    await request(app).post('/auth/register').send({
      username: 'attack_brute',
      password: 'CorrectPass123!',
      identityKey: 'ik',
      signedPrekey: 'spk',
      signedPrekeySig: 'sig',
      oneTimePrekeys: ['otpk'],
    });

    for (let i = 0; i < 25; i++) {
      await request(app).post('/auth/login')
        .send({ username: 'attack_brute', password: `wrong${i}` });
    }

    const correct = await request(app).post('/auth/login')
      .send({ username: 'attack_brute', password: 'CorrectPass123!' });

    expect(correct.status).toBe(429);
  });
});

// ── Information exposure ──────────────────────────────────────

describe('Metadata and information exposure', () => {
  it('error responses do not expose file paths', async () => {
    const res = await request(app).get('/nonexistent-route-xyz');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/\/home\//);
    expect(body).not.toMatch(/\/app\//);
    expect(body).not.toMatch(/node_modules/);
  });

  it('database errors are sanitised before reaching the client', async () => {
    const res = await request(app).post('/auth/login')
      .send({ username: null, password: null });
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/PostgreSQL|pg_|relation|column|ECONNREFUSED/i);
    expect(body).not.toHaveProperty('stack');
  });

  it('body size limit rejects oversized payloads', async () => {
    const bigPayload = {
      username: 'attack_big',
      password: 'TestPass123!',
      identityKey: 'x'.repeat(70000),
      signedPrekey: 'spk',
      signedPrekeySig: 'sig',
      oneTimePrekeys: ['otpk'],
    };
    const res = await request(app).post('/auth/register').send(bigPayload);
    expect([400, 413]).toContain(res.status);
  });
});
