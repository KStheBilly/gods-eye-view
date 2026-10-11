FROM node:24.19.0-bookworm-slim AS build

WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1

COPY package.json package-lock.json ./
# The full dependency set is required to build the browser app.
RUN npm ci --include=dev
COPY . .

# These three values are intentionally public browser tokens. Never pass a
# private provider key, access password, or Codex credential as a build arg.
ARG GOOGLE_MAPS_API_KEY
ARG CESIUM_ION_TOKEN
ARG MAPILLARY_CLIENT_TOKEN
RUN npm run build

FROM node:24.19.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    PUPPETEER_SKIP_DOWNLOAD=1

# Provider modules also read bundled source datasets and camera configuration.
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/hosted/start.js"]
