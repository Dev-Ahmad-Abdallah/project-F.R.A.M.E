import {
  registerSchema,
  loginSchema,
  sendMessageSchema,
  syncQuerySchema,
  keyUploadSchema,
  createRoomSchema,
  deviceRegisterSchema,
} from '../../src/middleware/validation';

// ── registerSchema ──

describe('registerSchema', () => {
  const validInput = {
    username: 'alice_01',
    password: 'securePass123',
    identityKey: 'base64identitykey',
    signedPrekey: 'base64signedprekey',
    signedPrekeySig: 'base64sig',
    oneTimePrekeys: ['otk1', 'otk2'],
  };

  it('accepts valid input', () => {
    const result = registerSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('rejects missing username', () => {
    const { username, ...rest } = validInput;
    const result = registerSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const { password, ...rest } = validInput;
    const result = registerSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing identityKey', () => {
    const { identityKey, ...rest } = validInput;
    const result = registerSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects password shorter than 8 characters', () => {
    const result = registerSchema.safeParse({ ...validInput, password: 'short' });
    expect(result.success).toBe(false);
  });

  it('rejects password longer than 128 characters', () => {
    const result = registerSchema.safeParse({ ...validInput, password: 'a'.repeat(129) });
    expect(result.success).toBe(false);
  });

  it('rejects username with invalid characters (spaces)', () => {
    const result = registerSchema.safeParse({ ...validInput, username: 'bad user' });
    expect(result.success).toBe(false);
  });

  it('rejects username with special characters (@)', () => {
    const result = registerSchema.safeParse({ ...validInput, username: 'bad@user' });
    expect(result.success).toBe(false);
  });

  it('allows hyphens and underscores in username', () => {
    const result = registerSchema.safeParse({ ...validInput, username: 'good-user_01' });
    expect(result.success).toBe(true);
  });

  it('rejects username shorter than 3 characters', () => {
    const result = registerSchema.safeParse({ ...validInput, username: 'ab' });
    expect(result.success).toBe(false);
  });

  it('rejects username longer than 32 characters', () => {
    const result = registerSchema.safeParse({ ...validInput, username: 'a'.repeat(33) });
    expect(result.success).toBe(false);
  });

  it('rejects empty oneTimePrekeys array', () => {
    const result = registerSchema.safeParse({ ...validInput, oneTimePrekeys: [] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 100 oneTimePrekeys', () => {
    const otks = Array.from({ length: 101 }, (_, i) => `otk${i}`);
    const result = registerSchema.safeParse({ ...validInput, oneTimePrekeys: otks });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 100 oneTimePrekeys', () => {
    const otks = Array.from({ length: 100 }, (_, i) => `otk${i}`);
    const result = registerSchema.safeParse({ ...validInput, oneTimePrekeys: otks });
    expect(result.success).toBe(true);
  });

  it('rejects missing signedPrekey', () => {
    const { signedPrekey, ...rest } = validInput;
    const result = registerSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing signedPrekeySig', () => {
    const { signedPrekeySig, ...rest } = validInput;
    const result = registerSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing oneTimePrekeys', () => {
    const { oneTimePrekeys, ...rest } = validInput;
    const result = registerSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ── loginSchema ──

describe('loginSchema', () => {
  it('accepts valid input', () => {
    const result = loginSchema.safeParse({ username: 'alice', password: 'pass1234' });
    expect(result.success).toBe(true);
  });

  it('accepts optional deviceId', () => {
    const result = loginSchema.safeParse({ username: 'alice', password: 'pass1234', deviceId: 'DEV123' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deviceId).toBe('DEV123');
    }
  });

  it('rejects missing username', () => {
    const result = loginSchema.safeParse({ password: 'pass1234' });
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const result = loginSchema.safeParse({ username: 'alice' });
    expect(result.success).toBe(false);
  });

  it('rejects empty username', () => {
    const result = loginSchema.safeParse({ username: '', password: 'pass1234' });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({ username: 'alice', password: '' });
    expect(result.success).toBe(false);
  });
});

// ── sendMessageSchema ──

describe('sendMessageSchema', () => {
  it('accepts valid input', () => {
    const result = sendMessageSchema.safeParse({
      roomId: '!room123:example.com',
      eventType: 'm.room.message',
      content: { body: 'hello', msgtype: 'm.text' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing roomId', () => {
    const result = sendMessageSchema.safeParse({
      eventType: 'm.room.message',
      content: { body: 'hello' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing eventType', () => {
    const result = sendMessageSchema.safeParse({
      roomId: '!room123:example.com',
      content: { body: 'hello' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing content', () => {
    const result = sendMessageSchema.safeParse({
      roomId: '!room123:example.com',
      eventType: 'm.room.message',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-object content', () => {
    const result = sendMessageSchema.safeParse({
      roomId: '!room123:example.com',
      eventType: 'm.room.message',
      content: 'not an object',
    });
    expect(result.success).toBe(false);
  });
});

// ── syncQuerySchema ──

describe('syncQuerySchema', () => {
  it('applies defaults when empty', () => {
    const result = syncQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeout).toBe(0);
      expect(result.data.limit).toBe(50);
      expect(result.data.since).toBeUndefined();
    }
  });

  it('accepts valid since token', () => {
    const result = syncQuerySchema.safeParse({ since: 's123_456' });
    expect(result.success).toBe(true);
  });

  it('clamps timeout to max 30000', () => {
    const result = syncQuerySchema.safeParse({ timeout: '50000' });
    expect(result.success).toBe(false);
  });

  it('rejects negative timeout', () => {
    const result = syncQuerySchema.safeParse({ timeout: '-1' });
    expect(result.success).toBe(false);
  });

  it('accepts timeout at upper bound', () => {
    const result = syncQuerySchema.safeParse({ timeout: '30000' });
    expect(result.success).toBe(true);
  });

  it('rejects limit below 1', () => {
    const result = syncQuerySchema.safeParse({ limit: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects limit above 100', () => {
    const result = syncQuerySchema.safeParse({ limit: '101' });
    expect(result.success).toBe(false);
  });

  it('accepts limit at bounds', () => {
    expect(syncQuerySchema.safeParse({ limit: '1' }).success).toBe(true);
    expect(syncQuerySchema.safeParse({ limit: '100' }).success).toBe(true);
  });

  it('coerces string numbers', () => {
    const result = syncQuerySchema.safeParse({ timeout: '5000', limit: '25' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeout).toBe(5000);
      expect(result.data.limit).toBe(25);
    }
  });
});

// ── keyUploadSchema ──

describe('keyUploadSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = keyUploadSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts oneTimePrekeys', () => {
    const result = keyUploadSchema.safeParse({ oneTimePrekeys: ['k1', 'k2'] });
    expect(result.success).toBe(true);
  });

  it('rejects more than 100 oneTimePrekeys', () => {
    const otks = Array.from({ length: 101 }, (_, i) => `otk${i}`);
    const result = keyUploadSchema.safeParse({ oneTimePrekeys: otks });
    expect(result.success).toBe(false);
  });

  it('passes through unknown fields', () => {
    const result = keyUploadSchema.safeParse({ customField: 'value' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).customField).toBe('value');
    }
  });

  it('accepts signedPrekey and signedPrekeySig', () => {
    const result = keyUploadSchema.safeParse({
      signedPrekey: 'spk',
      signedPrekeySig: 'sig',
    });
    expect(result.success).toBe(true);
  });
});

// ── createRoomSchema ──

describe('createRoomSchema', () => {
  it('accepts valid direct room', () => {
    const result = createRoomSchema.safeParse({
      roomType: 'direct',
      inviteUserIds: ['@bob:example.com'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid group room', () => {
    const result = createRoomSchema.safeParse({
      roomType: 'group',
      inviteUserIds: ['@bob:example.com', '@charlie:example.com'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid roomType', () => {
    const result = createRoomSchema.safeParse({
      roomType: 'channel',
      inviteUserIds: ['@bob:example.com'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty inviteUserIds', () => {
    const result = createRoomSchema.safeParse({
      roomType: 'direct',
      inviteUserIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 50 inviteUserIds', () => {
    const ids = Array.from({ length: 51 }, (_, i) => `@user${i}:example.com`);
    const result = createRoomSchema.safeParse({
      roomType: 'group',
      inviteUserIds: ids,
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 50 inviteUserIds', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `@user${i}:example.com`);
    const result = createRoomSchema.safeParse({
      roomType: 'group',
      inviteUserIds: ids,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing roomType', () => {
    const result = createRoomSchema.safeParse({
      inviteUserIds: ['@bob:example.com'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing inviteUserIds', () => {
    const result = createRoomSchema.safeParse({
      roomType: 'direct',
    });
    expect(result.success).toBe(false);
  });
});

// ── deviceRegisterSchema ──

describe('deviceRegisterSchema', () => {
  const validInput = {
    deviceId: 'DEVICE01',
    devicePublicKey: 'pubkey123',
    deviceSigningKey: 'sigkey123',
  };

  it('accepts valid input', () => {
    const result = deviceRegisterSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('accepts optional deviceDisplayName', () => {
    const result = deviceRegisterSchema.safeParse({
      ...validInput,
      deviceDisplayName: 'My Phone',
    });
    expect(result.success).toBe(true);
  });

  it('rejects deviceDisplayName longer than 64 characters', () => {
    const result = deviceRegisterSchema.safeParse({
      ...validInput,
      deviceDisplayName: 'x'.repeat(65),
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing deviceId', () => {
    const { deviceId, ...rest } = validInput;
    const result = deviceRegisterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing devicePublicKey', () => {
    const { devicePublicKey, ...rest } = validInput;
    const result = deviceRegisterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing deviceSigningKey', () => {
    const { deviceSigningKey, ...rest } = validInput;
    const result = deviceRegisterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects empty deviceId', () => {
    const result = deviceRegisterSchema.safeParse({ ...validInput, deviceId: '' });
    expect(result.success).toBe(false);
  });
});
