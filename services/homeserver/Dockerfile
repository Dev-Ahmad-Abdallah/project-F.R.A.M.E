# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace config and shared types
COPY package.json ./
COPY shared/package.json shared/
COPY shared/tsconfig.json shared/
COPY shared/types/ shared/types/
COPY services/homeserver/package.json services/homeserver/
COPY services/homeserver/tsconfig.json services/homeserver/

# Install dependencies
RUN npm install --workspace=@frame/shared --workspace=@frame/homeserver

# Copy source and migrations
COPY shared/ shared/
COPY services/homeserver/src/ services/homeserver/src/
COPY services/homeserver/migrations/ services/homeserver/migrations/

# Build shared types first, then homeserver
RUN npm run build --workspace=@frame/shared
RUN npm run build --workspace=@frame/homeserver

# Stage 2: Production
FROM node:20-alpine
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
WORKDIR /app

# Copy built artifacts and production dependencies
COPY --from=builder /app/package.json ./
COPY --from=builder /app/shared/package.json shared/
COPY --from=builder /app/shared/dist/ shared/dist/
COPY --from=builder /app/services/homeserver/package.json services/homeserver/
COPY --from=builder /app/services/homeserver/dist/ services/homeserver/dist/
COPY --from=builder /app/services/homeserver/migrations/ services/homeserver/migrations/
COPY --from=builder /app/node_modules/ node_modules/

USER appuser
EXPOSE 3000

# Run migrations then start server
CMD ["sh", "-c", "cd services/homeserver && npx node-pg-migrate up && node dist/server.js"]
