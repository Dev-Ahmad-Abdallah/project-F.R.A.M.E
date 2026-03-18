# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace config and shared types
COPY package.json ./
COPY shared/package.json shared/
COPY shared/tsconfig.json shared/
COPY shared/types/ shared/types/
COPY services/frontend/package.json services/frontend/
COPY services/frontend/tsconfig.json services/frontend/

# Install dependencies
RUN npm install --workspace=@frame/shared --workspace=@frame/frontend

# Copy source
COPY shared/ shared/
COPY services/frontend/src/ services/frontend/src/
COPY services/frontend/public/ services/frontend/public/

# Build shared types then frontend
RUN npm run build --workspace=@frame/shared
RUN cd services/frontend && npm run build

# Stage 2: Serve
FROM node:20-alpine
RUN npm install -g serve
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
WORKDIR /app
COPY --from=builder /app/services/frontend/build ./build
USER appuser
EXPOSE 3000
CMD ["serve", "-s", "build", "-l", "3000"]
