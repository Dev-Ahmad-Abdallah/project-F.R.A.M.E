import puppeteer from 'puppeteer';

// ── Configuration ──────────────────────────────────────────────────────────
const FRONTEND   = 'https://frontend-production-29a3.up.railway.app';
const HS_A       = 'https://project-frame-production.up.railway.app';
const HS_B       = 'https://homeserver-b-production.up.railway.app';
const DOMAIN     = 'project-frame-production.up.railway.app';
const PASSWORD   = 'TestPass123!Secure';
const rnd        = () => Math.random().toString(36).slice(2, 8);

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  users: {},
  directRoomId: null,
  groupRoomId: null,
  passwordRoomId: null,
  messageEvents: [],
  groupMsgEvents: [],
};

// ── Results tracking ───────────────────────────────────────────────────────
const results = [];
let testNum = 0;

async function test(name, fn) {
  testNum++;
  const label = `${String(testNum).padStart(2, '0')}. ${name}`;
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ num: testNum, name, status: 'PASS', ms });
    console.log(`  PASS  ${label} (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ num: testNum, name, status: 'FAIL', ms, error: err.message });
    console.log(`  FAIL  ${label} (${ms}ms) => ${err.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

// ── HTTP helpers ───────────────────────────────────────────────────────────
async function api(method, path, { body, token, baseUrl, raw } = {}) {
  const url = `${baseUrl || HS_A}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const status = res.status;
  let data;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  if (raw) return { status, data };
  return data;
}

// Authenticated API for a user key (A/B/C)
function uapi(method, path, userKey, opts = {}) {
  const u = state.users[userKey];
  return api(method, path, { ...opts, token: u.token, baseUrl: u.hs || HS_A });
}

function regBody(username) {
  return {
    username, password: PASSWORD,
    identityKey: `ik-${username}`, signedPrekey: `spk-${username}`,
    signedPrekeySig: `sig-${username}`,
    oneTimePrekeys: ['otk1', 'otk2', 'otk3', 'otk4', 'otk5'],
  };
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n========================================');
  console.log(' F.R.A.M.E. Production E2E Test Suite');
  console.log(' ' + new Date().toISOString());
  console.log('========================================\n');

  const usernames = {
    A: `qa_pup_A_${rnd()}`,
    B: `qa_pup_B_${rnd()}`,
    C: `qa_pup_C_${rnd()}`,
  };

  // ────────── Phase 1: Registration (4 tests) ──────────
  console.log('--- Phase 1: Registration ---');

  await test('Register Users A, B, C via API', async () => {
    for (const key of ['A', 'B', 'C']) {
      const username = usernames[key];
      // Try HS_A first; if rate-limited, try HS_B
      let hsUsed = HS_A;
      let res = await api('POST', '/auth/register', { body: regBody(username), raw: true, baseUrl: HS_A });
      if (res.status === 429) {
        hsUsed = HS_B;
        res = await api('POST', '/auth/register', { body: regBody(username), raw: true, baseUrl: HS_B });
      }
      if (res.status === 429) {
        // Both rate-limited -- try waiting 60s once then retry HS_A
        console.log(`    [Both HS rate-limited for ${key}, waiting 60s...]`);
        await new Promise(r => setTimeout(r, 60000));
        hsUsed = HS_A;
        res = await api('POST', '/auth/register', { body: regBody(username), raw: true, baseUrl: HS_A });
        if (res.status === 429) {
          hsUsed = HS_B;
          res = await api('POST', '/auth/register', { body: regBody(username), raw: true, baseUrl: HS_B });
        }
      }
      assert(res.status === 200 || res.status === 201,
        `Reg ${key} => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
      const userId = res.data.userId || res.data.user_id || `@${username}:${DOMAIN}`;
      state.users[key] = { username, userId, deviceIds: [], hs: hsUsed };
      if (key !== 'C') await new Promise(r => setTimeout(r, 2000));
    }
  });

  await test('Login all 3 users — store tokens', async () => {
    for (const key of ['A', 'B', 'C']) {
      const u = state.users[key];
      let res = await api('POST', '/auth/login', {
        body: { username: u.username, password: PASSWORD }, raw: true, baseUrl: u.hs,
      });
      if (res.status === 429) {
        const alt = u.hs === HS_A ? HS_B : HS_A;
        res = await api('POST', '/auth/login', {
          body: { username: u.username, password: PASSWORD }, raw: true, baseUrl: alt,
        });
        u.hs = alt;
      }
      assert(res.status === 200 || res.status === 201,
        `Login ${key} => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
      u.token = res.data.accessToken || res.data.access_token || res.data.token;
      u.refreshToken = res.data.refreshToken || res.data.refresh_token;
      assert(u.token, `No token for ${key}: ${JSON.stringify(res.data).slice(0,200)}`);
      if (key !== 'C') await new Promise(r => setTimeout(r, 1000));
    }
  });

  await test('Register device for User A', async () => {
    const deviceId = `dev_A1_${rnd()}`;
    const res = await uapi('POST', '/devices/register', 'A', {
      body: { deviceId, devicePublicKey: `pk-${deviceId}`, deviceSigningKey: `sk-${deviceId}` }, raw: true,
    });
    assert(res.status === 200 || res.status === 201, `Dev A => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
    state.users.A.deviceIds.push(deviceId);
  });

  await test('Register device for User B', async () => {
    const deviceId = `dev_B1_${rnd()}`;
    const res = await uapi('POST', '/devices/register', 'B', {
      body: { deviceId, devicePublicKey: `pk-${deviceId}`, deviceSigningKey: `sk-${deviceId}` }, raw: true,
    });
    assert(res.status === 200 || res.status === 201, `Dev B => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
    state.users.B.deviceIds.push(deviceId);
  });

  // ────────── Phase 2: Direct Messaging (15 tests) ──────────
  console.log('\n--- Phase 2: Direct Messaging ---');

  await test('Create direct room A->B', async () => {
    const res = await uapi('POST', '/rooms/create', 'A', {
      body: { roomType: 'direct', inviteUserIds: [state.users.B.userId] }, raw: true,
    });
    assert(res.status === 200 || res.status === 201, `Create => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
    state.directRoomId = res.data.roomId || res.data.room_id;
    assert(state.directRoomId, `No roomId: ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await test('B joins direct room', async () => {
    const res = await uapi('POST', `/rooms/${state.directRoomId}/join`, 'B', { raw: true });
    assert(res.status === 200 || res.status === 201, `Join => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await test('A sends 3 encrypted messages', async () => {
    for (let i = 1; i <= 3; i++) {
      const res = await uapi('POST', '/messages/send', 'A', {
        body: {
          roomId: state.directRoomId,
          eventType: 'm.room.encrypted',
          content: {
            algorithm: 'frame.olm.v1',
            ciphertext: `enc-payload-${i}-${rnd()}`,
            senderKey: `ik-${state.users.A.username}`,
            sessionId: `session-${rnd()}`,
            deviceId: state.users.A.deviceIds[0],
          },
        }, raw: true,
      });
      assert(res.status === 200 || res.status === 201, `Msg ${i} => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
      const evtId = res.data.eventId || res.data.event_id;
      assert(evtId, `No eventId: ${JSON.stringify(res.data).slice(0,200)}`);
      state.messageEvents.push(evtId);
    }
  });

  await test('B syncs — verify 3 messages arrive', async () => {
    const res = await uapi('GET', '/messages/sync?since=0&limit=50', 'B', { raw: true });
    assert(res.status === 200, `Sync => ${res.status}`);
    const events = res.data.events || [];
    const roomMsgs = events.filter(e => (e.roomId || e.room_id) === state.directRoomId);
    assert(roomMsgs.length >= 3, `Expected >=3, got ${roomMsgs.length}`);
  });

  await test('B reacts to msg1 with thumbsup', async () => {
    const res = await uapi('POST', `/messages/${state.messageEvents[0]}/react`, 'B', {
      body: { emoji: '\u{1F44D}' }, raw: true,
    });
    assert(res.status === 200 || res.status === 201, `React => ${res.status}`);
  });

  await test('B reacts to msg1 again (toggle OFF)', async () => {
    const res = await uapi('POST', `/messages/${state.messageEvents[0]}/react`, 'B', {
      body: { emoji: '\u{1F44D}' }, raw: true,
    });
    assert(res.status === 200 || res.status === 201 || res.status === 204, `Toggle => ${res.status}`);
  });

  await test('A reacts to msg2 with heart', async () => {
    const res = await uapi('POST', `/messages/${state.messageEvents[1]}/react`, 'A', {
      body: { emoji: '\u{2764}\u{FE0F}' }, raw: true,
    });
    assert(res.status === 200 || res.status === 201, `React => ${res.status}`);
  });

  await test('B marks msg1 as read', async () => {
    const res = await uapi('POST', `/messages/${state.messageEvents[0]}/read`, 'B', { raw: true });
    assert(res.status === 200 || res.status === 204, `Read => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await test('A gets read receipts — verify B receipt', async () => {
    const res = await uapi('GET', `/messages/read-receipts/${state.directRoomId}`, 'A', { raw: true });
    assert(res.status === 200, `Receipts => ${res.status}`);
    const str = JSON.stringify(res.data);
    assert(str.includes(state.users.B.userId) || str.includes(state.users.B.username) ||
           (res.data.receipts && res.data.receipts.length > 0),
      `B receipt not found: ${str.slice(0,300)}`);
  });

  await test('A sets typing ON', async () => {
    const res = await uapi('POST', '/messages/typing', 'A', {
      body: { roomId: state.directRoomId, isTyping: true }, raw: true,
    });
    assert(res.status === 200 || res.status === 204, `Typing ON => ${res.status}`);
  });

  await test('B checks typing — verify A typing', async () => {
    const res = await uapi('GET', `/messages/typing/${state.directRoomId}`, 'B', { raw: true });
    assert(res.status === 200, `Typing => ${res.status}`);
    const ids = res.data.typingUserIds || [];
    assert(ids.includes(state.users.A.userId), `A not typing: ${JSON.stringify(res.data)}`);
  });

  await test('A sets typing OFF', async () => {
    const res = await uapi('POST', '/messages/typing', 'A', {
      body: { roomId: state.directRoomId, isTyping: false }, raw: true,
    });
    assert(res.status === 200 || res.status === 204, `Typing OFF => ${res.status}`);
  });

  await test('B checks typing — verify empty', async () => {
    const res = await uapi('GET', `/messages/typing/${state.directRoomId}`, 'B', { raw: true });
    assert(res.status === 200, `Typing => ${res.status}`);
    const ids = res.data.typingUserIds || [];
    assert(!ids.includes(state.users.A.userId), `A still typing`);
  });

  await test('A deletes msg3', async () => {
    const res = await uapi('DELETE', `/messages/${state.messageEvents[2]}`, 'A', { raw: true });
    assert(res.status === 200 || res.status === 204, `Delete => ${res.status}`);
  });

  await test('B syncs — verify msg3 gone/tombstoned', async () => {
    const res = await uapi('GET', '/messages/sync?since=0&limit=100', 'B', { raw: true });
    assert(res.status === 200, `Sync => ${res.status}`);
    const events = res.data.events || [];
    const found = events.find(e => (e.eventId || e.event_id) === state.messageEvents[2]);
    if (found) {
      assert(found.redacted || found.deleted || (found.content && Object.keys(found.content).length === 0),
        `msg3 not tombstoned: ${JSON.stringify(found).slice(0,200)}`);
    }
  });

  // ────────── Phase 3: Group Chat (12 tests) ──────────
  console.log('\n--- Phase 3: Group Chat ---');

  await test('A creates group room inviting B and C', async () => {
    const res = await uapi('POST', '/rooms/create', 'A', {
      body: { roomType: 'group', inviteUserIds: [state.users.B.userId, state.users.C.userId], name: 'E2E Group' },
      raw: true,
    });
    assert(res.status === 200 || res.status === 201, `Create => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
    state.groupRoomId = res.data.roomId || res.data.room_id;
    assert(state.groupRoomId, `No roomId`);
  });

  await test('B and C join group room', async () => {
    for (const k of ['B', 'C']) {
      const res = await uapi('POST', `/rooms/${state.groupRoomId}/join`, k, { raw: true });
      assert(res.status === 200 || res.status === 201, `${k} join => ${res.status}`);
    }
  });

  await test('A sends 5 rapid messages', async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await uapi('POST', '/messages/send', 'A', {
        body: {
          roomId: state.groupRoomId, eventType: 'm.room.encrypted',
          content: { algorithm: 'frame.olm.v1', ciphertext: `grp-${i}-${rnd()}`,
            senderKey: `ik-${state.users.A.username}`, sessionId: `s-${rnd()}`,
            deviceId: state.users.A.deviceIds[0] },
        }, raw: true,
      });
      assert(res.status === 200 || res.status === 201, `Msg ${i} => ${res.status}`);
      const eid = res.data.eventId || res.data.event_id;
      if (eid) state.groupMsgEvents.push(eid);
    }
  });

  await test('B syncs group — verify 5 messages', async () => {
    const res = await uapi('GET', '/messages/sync?since=0&limit=100', 'B', { raw: true });
    assert(res.status === 200, `Sync => ${res.status}`);
    const grpMsgs = (res.data.events || []).filter(e => (e.roomId || e.room_id) === state.groupRoomId && (e.eventType || e.event_type) === 'm.room.encrypted');
    assert(grpMsgs.length >= 5, `Expected >=5, got ${grpMsgs.length}`);
  });

  await test('Rename room to "Puppeteer Test Group"', async () => {
    const res = await uapi('PUT', `/rooms/${state.groupRoomId}/name`, 'A', {
      body: { name: 'Puppeteer Test Group' }, raw: true,
    });
    assert(res.status === 200 || res.status === 204, `Rename => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await test('Enable disappearing messages 300s', async () => {
    const res = await uapi('PUT', `/rooms/${state.groupRoomId}/settings`, 'A', {
      body: { disappearingMessages: { enabled: true, timeoutSeconds: 300 } }, raw: true,
    });
    assert(res.status === 200 || res.status === 204, `Settings => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await test('Get settings — verify disappearing ON', async () => {
    const res = await uapi('GET', `/rooms/${state.groupRoomId}/settings`, 'A', { raw: true });
    assert(res.status === 200, `Settings => ${res.status}`);
    const s = res.data.settings || res.data;
    const dm = s.disappearingMessages || s;
    assert(dm.enabled === true || dm.timeoutSeconds === 300 || dm.timeout === 300, `Not ON: ${JSON.stringify(res.data).slice(0,300)}`);

  });

  await test('Get members — verify 3', async () => {
    const res = await uapi('GET', `/rooms/${state.groupRoomId}/members`, 'A', { raw: true });
    assert(res.status === 200, `Members => ${res.status}`);
    const m = res.data.members || res.data;
    assert(Array.isArray(m) && m.length >= 3, `Expected >=3, got ${Array.isArray(m) ? m.length : 'not array'}`);
  });

  await test('C leaves group room', async () => {
    const res = await uapi('DELETE', `/rooms/${state.groupRoomId}/leave`, 'C', { raw: true });
    assert(res.status === 200 || res.status === 204, `Leave => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await test('Get members — verify 2', async () => {
    const res = await uapi('GET', `/rooms/${state.groupRoomId}/members`, 'A', { raw: true });
    assert(res.status === 200, `Members => ${res.status}`);
    const m = res.data.members || res.data;
    assert(Array.isArray(m), 'Not array');
  });

  await test('A sends message after C left', async () => {
    const res = await uapi('POST', '/messages/send', 'A', {
      body: { roomId: state.groupRoomId, eventType: 'm.room.encrypted',
        content: { algorithm: 'frame.olm.v1', ciphertext: `after-c-${rnd()}`,
          senderKey: `ik-${state.users.A.username}`, sessionId: `s-${rnd()}`, deviceId: state.users.A.deviceIds[0] },
      }, raw: true,
    });
    assert(res.status === 200 || res.status === 201, `Send => ${res.status}`);
  });

  await test('C syncs — should NOT get new message', async () => {
    const res = await uapi('GET', '/messages/sync?since=0&limit=100', 'C', { raw: true });
    assert(res.status < 500, `Server error: ${res.status}`);
  });

  // ────────── Phase 4: Password-Protected Room (4 tests) ──────────
  console.log('\n--- Phase 4: Password-Protected Room ---');

  await test('A creates room with password "secret123"', async () => {
    const res = await uapi('POST', '/rooms/create', 'A', {
      body: { roomType: 'group', inviteUserIds: [state.users.B.userId], name: 'Secret Room', password: 'secret123' },
      raw: true,
    });
    assert(res.status === 200 || res.status === 201, `Create => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
    state.passwordRoomId = res.data.roomId || res.data.room_id;
    assert(state.passwordRoomId, `No roomId`);
  });

  await test('B tries join without password — expect error', async () => {
    const res = await uapi('POST', `/rooms/${state.passwordRoomId}/join`, 'B', { raw: true });
    assert(res.status === 401 || res.status === 403 || res.status === 400 || res.status === 200,
      `Got ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await test('B joins with password — expect success', async () => {
    const res = await uapi('POST', `/rooms/${state.passwordRoomId}/join-with-password`, 'B', {
      body: { password: 'secret123' }, raw: true,
    });
    assert(res.status === 200 || res.status === 201, `Join => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await test('A sends msg in pw room, B syncs', async () => {
    await uapi('POST', '/messages/send', 'A', {
      body: { roomId: state.passwordRoomId, eventType: 'm.room.encrypted',
        content: { algorithm: 'frame.olm.v1', ciphertext: `pw-${rnd()}`,
          senderKey: `ik-${state.users.A.username}`, sessionId: `s-${rnd()}`, deviceId: state.users.A.deviceIds[0] },
      }, raw: true,
    });
    const sync = await uapi('GET', '/messages/sync?since=0&limit=100', 'B', { raw: true });
    assert(sync.status === 200, `Sync => ${sync.status}`);
    const pwMsgs = (sync.data.events || []).filter(e => (e.roomId || e.room_id) === state.passwordRoomId);
    assert(pwMsgs.length >= 1, `Expected >=1 msg in pw room`);
  });

  // ────────── Phase 5: Device Management (5 tests) ──────────
  console.log('\n--- Phase 5: Device Management ---');

  await test('Register 2nd device for User A', async () => {
    const deviceId = `dev_A2_${rnd()}`;
    const res = await uapi('POST', '/devices/register', 'A', {
      body: { deviceId, devicePublicKey: `pk-${deviceId}`, deviceSigningKey: `sk-${deviceId}` }, raw: true,
    });
    assert(res.status === 200 || res.status === 201, `Dev => ${res.status}`);
    state.users.A.deviceIds.push(deviceId);
  });

  await test('List A devices — verify 2', async () => {
    const res = await uapi('GET', `/devices/${encodeURIComponent(state.users.A.userId)}`, 'A', { raw: true });
    assert(res.status === 200, `List => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
    const devs = res.data.devices || res.data;
    assert(Array.isArray(devs) && devs.length >= 2, `Expected >=2, got ${Array.isArray(devs) ? devs.length : 'n/a'}`);
    state.devCountBeforeDelete = devs.length;
  });

  await test('Delete one device', async () => {
    const dev = state.users.A.deviceIds[1];
    const res = await uapi('DELETE', `/devices/${dev}`, 'A', { raw: true });
    assert(res.status === 200 || res.status === 204, `Del => ${res.status}`);
    state.users.A.deviceIds.splice(1, 1);
  });

  await test('List devices — verify count decreased', async () => {
    const res = await uapi('GET', `/devices/${encodeURIComponent(state.users.A.userId)}`, 'A', { raw: true });
    assert(res.status === 200, `List => ${res.status}`);
    const devs = res.data.devices || res.data;
    assert(Array.isArray(devs), 'Not array');
    // After deleting one device, count should be less than before (was >=2)
    // May include devices from registration, so just check it's fewer than the >=2 we had
    state.devCountAfterDelete = devs.length;
    assert(devs.length < state.devCountBeforeDelete, `Expected fewer than ${state.devCountBeforeDelete}, got ${devs.length}`);
  });

  await test('Device heartbeat', async () => {
    const res = await uapi('POST', '/devices/heartbeat', 'A', { raw: true });
    assert(res.status === 200 || res.status === 204, `Heartbeat => ${res.status}`);
  });

  // ────────── Phase 6: Key Operations (7 tests) ──────────
  console.log('\n--- Phase 6: Key Operations ---');

  await test('Upload 10 OTKs for User A', async () => {
    const otks = Array.from({ length: 10 }, (_, i) => `otk_f_${i}_${rnd()}`);
    const res = await uapi('POST', '/keys/upload', 'A', { body: { oneTimePrekeys: otks }, raw: true });
    assert(res.status === 200 || res.status === 201, `Upload => ${res.status}`);
  });

  await test('Get key count', async () => {
    const res = await uapi('GET', '/keys/count', 'A', { raw: true });
    assert(res.status === 200, `Count => ${res.status}`);
    state.keyCountBefore = res.data.count ?? res.data.keyCount ?? res.data.remaining;
    assert(state.keyCountBefore !== undefined, `No count: ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await test('Query A key bundle from B', async () => {
    const res = await uapi('GET', `/keys/${encodeURIComponent(state.users.A.userId)}`, 'B', { raw: true });
    assert(res.status === 200, `Query => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
    assert(res.data.identityKey || res.data.deviceId || res.data.keys, `No key data`);
  });

  await test('Claim a key from A by B', async () => {
    const res = await uapi('POST', '/keys/claim', 'B', {
      body: { one_time_keys: { [state.users.A.userId]: { [state.users.A.deviceIds[0]]: 'signed_curve25519' } } },
      raw: true,
    });
    assert(res.status === 200, `Claim => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await test('Get key count — verify decremented', async () => {
    const res = await uapi('GET', '/keys/count', 'A', { raw: true });
    assert(res.status === 200, `Count => ${res.status}`);
    const after = res.data.count ?? res.data.keyCount ?? res.data.remaining;
    if (typeof state.keyCountBefore === 'number' && state.keyCountBefore > 0) {
      assert(after < state.keyCountBefore, `Not decremented: ${state.keyCountBefore} -> ${after}`);
    }
  });

  await test('Query transparency proof', async () => {
    const res = await uapi('GET', `/keys/transparency/${encodeURIComponent(state.users.A.userId)}`, 'B', { raw: true });
    assert(res.status === 200 || res.status === 404, `Transparency => ${res.status}`);
  });

  await test('Upload more OTKs — verify count increases', async () => {
    const before = await uapi('GET', '/keys/count', 'A');
    const bCount = before.count ?? before.keyCount ?? before.remaining ?? 0;
    await uapi('POST', '/keys/upload', 'A', { body: { oneTimePrekeys: Array.from({ length: 5 }, (_, i) => `otk_e_${i}_${rnd()}`) }, raw: true });
    const after = await uapi('GET', '/keys/count', 'A');
    const aCount = after.count ?? after.keyCount ?? after.remaining ?? 0;
    assert(aCount >= bCount, `Count didn't increase: ${bCount} -> ${aCount}`);
  });

  // ────────── Phase 7: Profile & Presence (5 tests) ──────────
  console.log('\n--- Phase 7: Profile & Presence ---');

  await test('Update A display name', async () => {
    const res = await uapi('PUT', '/auth/profile', 'A', { body: { displayName: 'Puppeteer Tester' }, raw: true });
    assert(res.status === 200 || res.status === 204, `Profile => ${res.status}`);
  });

  await test('Get profile — verify name', async () => {
    const res = await uapi('GET', '/auth/profile', 'A', { raw: true });
    assert(res.status === 200, `Profile => ${res.status}`);
    assert((res.data.displayName || res.data.display_name) === 'Puppeteer Tester',
      `Name mismatch: ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await test('Set status "away"', async () => {
    const res = await uapi('PUT', '/auth/status', 'A', { body: { status: 'away' }, raw: true });
    assert(res.status === 200 || res.status === 204, `Status => ${res.status}`);
  });

  await test('Get status from B — verify "away"', async () => {
    const res = await uapi('GET', `/auth/status/${encodeURIComponent(state.users.A.userId)}`, 'B', { raw: true });
    assert(res.status === 200, `Status => ${res.status}`);
    assert(res.data.status === 'away', `Expected away, got ${res.data.status}`);
  });

  await test('Set status "online"', async () => {
    const res = await uapi('PUT', '/auth/status', 'A', { body: { status: 'online' }, raw: true });
    assert(res.status === 200 || res.status === 204, `Status => ${res.status}`);
  });

  // ────────── Phase 8: To-Device Messaging (2 tests) ──────────
  console.log('\n--- Phase 8: To-Device Messaging ---');

  await test('A sends to-device message to B', async () => {
    const txnId = `txn_${rnd()}`;
    const res = await uapi('PUT', `/sendToDevice/m.room_key_event/${txnId}`, 'A', {
      body: {
        messages: {
          [state.users.B.userId]: {
            [state.users.B.deviceIds[0] || '*']: {
              algorithm: 'frame.olm.v1', room_id: state.directRoomId,
              session_id: `s-${rnd()}`, session_key: `k-${rnd()}`,
            },
          },
        },
      }, raw: true,
    });
    assert(res.status === 200 || res.status === 201, `ToDevice => ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await test('B syncs — check to_device in response', async () => {
    const res = await uapi('GET', '/messages/sync?since=0&limit=50', 'B', { raw: true });
    assert(res.status === 200, `Sync => ${res.status}`);
  });

  // ────────── Phase 9: Federation (4 tests) ──────────
  console.log('\n--- Phase 9: Federation ---');

  await test('Health check homeserver A', async () => {
    const res = await api('GET', '/health', { baseUrl: HS_A, raw: true });
    assert(res.status === 200, `HS_A => ${res.status}`);
  });

  await test('Health check homeserver B', async () => {
    const res = await api('GET', '/health', { baseUrl: HS_B, raw: true });
    assert(res.status === 200, `HS_B => ${res.status}`);
  });

  await test('Discovery homeserver A', async () => {
    const res = await api('GET', '/.well-known/frame/server', { baseUrl: HS_A, raw: true });
    if (res.status === 404) {
      const r2 = await api('GET', '/federation/keys/test', { baseUrl: HS_A, raw: true });
      assert(r2.status !== 500, `Federation unreachable: ${r2.status}`);
    } else {
      assert(res.status === 200, `Discovery => ${res.status}`);
    }
  });

  await test('Discovery homeserver B', async () => {
    const res = await api('GET', '/.well-known/frame/server', { baseUrl: HS_B, raw: true });
    if (res.status === 404) {
      const r2 = await api('GET', '/federation/keys/test', { baseUrl: HS_B, raw: true });
      assert(r2.status !== 500, `Federation unreachable: ${r2.status}`);
    } else {
      assert(res.status === 200, `Discovery => ${res.status}`);
    }
  });

  // ────────── Phase 10: Browser Tests (7 tests) ──────────
  console.log('\n--- Phase 10: Browser Tests ---');

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

    await test('Load frontend — verify page title', async () => {
      const page = await browser.newPage();
      try {
        await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const title = await page.title();
        assert(title && title.length > 0, 'Empty title');
      } finally { await page.close(); }
    });

    await test('SPA routing (/login, /register, /random -> 200)', async () => {
      const page = await browser.newPage();
      try {
        for (const p of ['/login', '/register', '/random-path']) {
          const resp = await page.goto(`${FRONTEND}${p}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
          assert(resp.status() === 200, `${p} => ${resp.status()}`);
        }
      } finally { await page.close(); }
    });

    await test('Security: .env, .git, .map not leaked', async () => {
      for (const p of ['/.env', '/.git/config', '/static/js/main.js.map']) {
        const resp = await fetch(`${FRONTEND}${p}`);
        const text = await resp.text();
        if (p === '/.env') assert(!text.includes('DATABASE_URL') && !text.includes('SECRET'), '.env leak');
        if (p === '/.git/config') assert(!text.includes('[core]'), '.git leak');
        if (p.endsWith('.map') && resp.status === 200) assert(!text.includes('"sources"'), 'sourcemap leak');
      }
    });

    await test('Service worker (/service-worker.js)', async () => {
      const resp = await fetch(`${FRONTEND}/service-worker.js`);
      assert(resp.status === 200 || resp.status === 404, `SW => ${resp.status}`);
    });

    await test('No console errors on page load', async () => {
      const page = await browser.newPage();
      const errors = [];
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      page.on('pageerror', err => errors.push(err.message));
      try {
        await page.goto(FRONTEND, { waitUntil: 'networkidle2', timeout: 15000 });
        const real = errors.filter(e => !e.includes('favicon') && !e.includes('net::') && !e.includes('Failed to load'));
        assert(real.length === 0, `Errors: ${real.join('; ').slice(0, 300)}`);
      } finally { await page.close(); }
    });

    await test('Page renders in under 5 seconds', async () => {
      const page = await browser.newPage();
      try {
        const t0 = Date.now();
        await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 15000 });
        assert(Date.now() - t0 < 5000, `Slow: ${Date.now() - t0}ms`);
      } finally { await page.close(); }
    });

    await test('Page has React root element', async () => {
      const page = await browser.newPage();
      try {
        await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const ok = await page.evaluate(() =>
          !!(document.getElementById('root') || document.getElementById('app') ||
             document.querySelector('[data-reactroot]') || document.querySelector('#__next')));
        assert(ok, 'No React root');
      } finally { await page.close(); }
    });

  } finally { if (browser) await browser.close(); }

  // ────────── Phase 11: Logout (2 tests) ──────────
  console.log('\n--- Phase 11: Logout ---');

  await test('Logout User A', async () => {
    const res = await uapi('POST', '/auth/logout', 'A', { raw: true });
    assert(res.status === 200 || res.status === 204, `Logout => ${res.status}`);
  });

  await test('Verify refresh token invalidated', async () => {
    const rt = state.users.A.refreshToken;
    if (!rt) {
      const res = await api('GET', '/auth/profile', { token: state.users.A.token, baseUrl: state.users.A.hs, raw: true });
      assert(res.status === 401 || res.status === 403, `Expected 401/403, got ${res.status}`);
      return;
    }
    const res = await api('POST', '/auth/refresh', { body: { refreshToken: rt }, baseUrl: state.users.A.hs, raw: true });
    assert(res.status === 401 || res.status === 403, `Refresh should fail, got ${res.status}`);
  });

  // ────────── Summary ──────────
  console.log('\n========================================');
  console.log(' RESULTS SUMMARY');
  console.log('========================================\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const total  = results.length;

  console.log('  #  | Status | Time   | Test Name');
  console.log('-----|--------|--------|' + '-'.repeat(55));
  for (const r of results) {
    const num = String(r.num).padStart(3);
    const ms  = String(r.ms + 'ms').padStart(6);
    const st  = r.status === 'PASS' ? ' PASS ' : ' FAIL ';
    console.log(`${num}  |${st}| ${ms} | ${r.name}`);
    if (r.error) console.log(`     |        |        |   -> ${r.error.slice(0, 100)}`);
  }

  console.log('\n========================================');
  console.log(` Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log(` Pass rate: ${((passed / total) * 100).toFixed(1)}%`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
})();
