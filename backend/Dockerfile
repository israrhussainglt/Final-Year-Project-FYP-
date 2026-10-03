# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — deps: install all dependencies (incl. devDependencies) once,
# with the native toolchain better-sqlite3 needs to compile its addon.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2 — build: compile TypeScript to dist/ using the full dep set above.
# Invoke tsc directly (not `npm run build`) — package.json wires a
# `prebuild` lifecycle hook to `node scripts/seed.js`, which needs the data
# dir / runtime env this stage doesn't have; seeding is a startup concern,
# handled by the runtime stage's CMD instead.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# ---------------------------------------------------------------------------
# Stage 3 — prod-deps: install only production dependencies, rebuilt clean
# so the shipped better-sqlite3 addon matches this exact base image.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Stage 4 — runtime: small final image, no compilers, non-root user.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Non-root user to run the app as.
RUN addgroup -S pulseid && adduser -S pulseid -G pulseid

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY scripts ./scripts

# Persistent SQLite data lives here — mount a volume at /app/data.
RUN mkdir -p /app/data && chown -R pulseid:pulseid /app

USER pulseid

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Create/migrate the schema (idempotent — never wipes existing data) then start.
CMD ["sh", "-c", "node scripts/seed.js && node dist/server.js"]
