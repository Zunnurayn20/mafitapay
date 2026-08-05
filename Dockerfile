# MafitaPay — production image for Railway
# Requires Node 22+ for built-in node:sqlite
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# package-lock.json can drift from package.json between dependency bumps;
# npm install reconciles and regenerates the lock file instead of failing
# hard like npm ci does when they're out of sync.
RUN npm install

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# node:sqlite is still experimental on Node 22
ENV NODE_OPTIONS=--experimental-sqlite
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# SQLite + uploads live here — mount a Railway volume at /app/data
# Run as root so Railway volume mounts are writable for SQLite.
EXPOSE 3000

CMD ["npx", "next", "start", "--hostname", "0.0.0.0"]
