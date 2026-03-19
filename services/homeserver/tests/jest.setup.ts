// Set required environment variables for tests
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-secret-minimum-32-characters-long-for-validation';
process.env.HOMESERVER_DOMAIN = 'test.local';
process.env.FEDERATION_SIGNING_KEY = 'test-signing-key';
process.env.NODE_ENV = 'test';
