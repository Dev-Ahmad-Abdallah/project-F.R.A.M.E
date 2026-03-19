import Redis from 'ioredis';
import { getConfig } from '../config';

const config = getConfig();

// Main client for commands (SET, GET, INCR, etc.)
export const redisClient = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 10,
  enableReadyCheck: true,
  retryStrategy(times) {
    if (times > 20) return null; // give up after ~40s
    return Math.min(times * 200, 5000);
  },
  lazyConnect: true,
});

// Dedicated subscriber client for pub/sub (cannot be used for regular commands)
export const redisSubscriber = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 10,
  enableReadyCheck: true,
  retryStrategy(times) {
    if (times > 20) return null;
    return Math.min(times * 200, 5000);
  },
  lazyConnect: true,
});

redisClient.on('error', (err) => {
  console.error('Redis client error:', err);
});

redisSubscriber.on('error', (err) => {
  console.error('Redis subscriber error:', err);
});

export async function connectRedis(): Promise<void> {
  await redisClient.connect();
  await redisSubscriber.connect();
}

export async function closeRedis(): Promise<void> {
  await redisClient.quit();
  await redisSubscriber.quit();
}
