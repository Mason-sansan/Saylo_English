# Build from repository ROOT (Saylo_English). Fixes Railway when `web` must not be a git submodule.
# Frontend + voice-server in one image, same origin.

FROM node:22-alpine AS frontend
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/index.html web/vite.config.ts web/tsconfig.json web/tsconfig.app.json web/tsconfig.node.json web/eslint.config.js ./
COPY web/public ./public
COPY web/src ./src
ARG VITE_USE_SERVER_AUTH=1
ENV VITE_USE_SERVER_AUTH=$VITE_USE_SERVER_AUTH
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app/voice-server
COPY web/voice-server/package.json web/voice-server/package-lock.json ./
RUN npm ci --omit=dev
COPY web/voice-server/ ./
COPY --from=frontend /app/dist ./dist
ENV NODE_ENV=production
ENV PORT=8787
ENV SERVE_STATIC=1
ENV STATIC_DIR=/app/voice-server/dist
WORKDIR /app/voice-server
EXPOSE 8787
CMD ["node", "server.js"]
