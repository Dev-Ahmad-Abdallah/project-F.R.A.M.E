# ── Stage 1: Build React app ─────────────────────────────────
# Pinned to exact patch version — never :latest or floating tags
FROM node:22-alpine3.21 AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY shared/tsconfig.json shared/
COPY shared/types/ shared/types/
COPY services/frontend/package.json services/frontend/
COPY services/frontend/tsconfig.json services/frontend/

# npm ci — lockfile-based deterministic install
RUN npm ci --workspace=@frame/shared --workspace=@frame/frontend

COPY shared/ shared/
COPY services/frontend/src/ services/frontend/src/
COPY services/frontend/public/ services/frontend/public/

# Build-time env var — baked into JS bundle (not secret)
ARG REACT_APP_HOMESERVER_URL
ENV REACT_APP_HOMESERVER_URL=$REACT_APP_HOMESERVER_URL

RUN npm run build --workspace=@frame/shared
# CI=false: prevents CRA from treating warnings as errors
# DISABLE_ESLINT_PLUGIN=true: skip ESLint in Docker (we lint separately in CI)
ENV CI=false
ENV DISABLE_ESLINT_PLUGIN=true
RUN cd services/frontend && npm run build

# ── Stage 2: nginx static server ─────────────────────────────
# nginx:alpine — not `serve` — so we can set all security headers
FROM nginx:1.27-alpine3.21

# Pull latest security patches
RUN apk update && apk upgrade --no-cache

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy hardened nginx config (CSP, HSTS, X-Frame-Options, etc.)
COPY services/frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built React app
COPY --from=builder /app/services/frontend/build /usr/share/nginx/html

# Remove source maps from production image
RUN find /usr/share/nginx/html -name "*.map" -delete 2>/dev/null || true

ENV PORT=80
EXPOSE 80

# Docker-native health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

# Substitute $PORT in nginx config at runtime so Railway can set it
CMD ["sh", "-c", "envsubst '${PORT}' < /etc/nginx/conf.d/default.conf > /tmp/nginx.conf && mv /tmp/nginx.conf /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
