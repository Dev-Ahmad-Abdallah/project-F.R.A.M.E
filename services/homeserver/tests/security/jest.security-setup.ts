// Security test setup — use port 0 so OS assigns a random available port
// This prevents EADDRINUSE when multiple test files re-import server.ts
process.env.PORT = '0';
