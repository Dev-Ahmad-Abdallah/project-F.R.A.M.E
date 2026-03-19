import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(32),
  BCRYPT_SALT_ROUNDS: z.coerce.number().min(10).max(15).default(12),
  HOMESERVER_DOMAIN: z.string(),
  FEDERATION_SIGNING_KEY: z.string(),
  FEDERATION_PEERS: z.string().default(''),
  CORS_ORIGINS: z.string().default(''),
  DB_SSL_REJECT_UNAUTHORIZED: z.coerce.boolean().default(true),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Invalid environment variables:', result.error.format());
      process.exit(1);
    }
    _config = result.data;
  }
  return _config;
}

export function getCorsOrigins(): string[] {
  const config = getConfig();
  return config.CORS_ORIGINS
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getFederationPeers(): string[] {
  const config = getConfig();
  return config.FEDERATION_PEERS
    .split(',')
    .map((peer) => peer.trim())
    .filter(Boolean);
}
