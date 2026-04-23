# Single-container deploy: Vite build + voice-server (same origin for /api + WebSocket).
# Build from repo directory `web/` (this folder).

FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json eslint.config.js ./
COPY public ./public
COPY src ./src
ARG VITE_USE_SERVER_AUTH=1
ENV VITE_USE_SERVER_AUTH=$VITE_USE_SERVER_AUTH
RUN npm run build

# bookworm: better-sqlite3 has prebuilds for glibc (Alpine/musl often breaks npm ci).
FROM node:22-bookworm-slim AS runner
WORKDIR /app/voice-server
COPY voice-server/package.json voice-server/package-lock.json ./
RUN npm ci --omit=dev
COPY voice-server/ ./
COPY --from=frontend /app/dist ./dist
ENV NODE_ENV=production
ENV PORT=8787
ENV SERVE_STATIC=1
ENV STATIC_DIR=/app/voice-server/dist
WORKDIR /app/voice-server
EXPOSE 8787
CMD ["node", "server.js"]
