# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — deps: install dependencies once, cached separately from source
# so editing app code doesn't invalidate the (slow) npm ci layer.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2 — build: compile the Next.js app. NEXT_PUBLIC_* vars are baked
# into the client bundle at build time, so they're accepted as build args
# and re-exported as ENV before `next build` runs.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3 — runtime: Next.js "standalone" output only — a minimal server.js
# plus the trimmed node_modules it depends on. No compilers, non-root user.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S pulseid && adduser -S pulseid -G pulseid

COPY --from=build /app/public ./public
COPY --from=build --chown=pulseid:pulseid /app/.next/standalone ./
COPY --from=build --chown=pulseid:pulseid /app/.next/static ./.next/static

USER pulseid

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 3000) + '/', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
