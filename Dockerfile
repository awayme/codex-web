# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS builder

ARG CODEX_APP_VERSION=26.721.30844
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    g++ \
    make \
    patch \
    python3 \
    unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts \
  && npm rebuild better-sqlite3

COPY assets/ ./assets/
COPY patches/ ./patches/
COPY scripts/prepare_asar ./scripts/prepare_asar
COPY src/ ./src/
COPY vite.browser.config.ts ./

RUN curl --fail --location --retry 3 --retry-delay 2 \
    --output /tmp/codex-app.zip \
    "https://persistent.oaistatic.com/codex-app-prod/ChatGPT-darwin-arm64-${CODEX_APP_VERSION}.zip" \
  && HOSTED_CODEX_APP_ZIP=/tmp/codex-app.zip npm run build \
  && rm -rf /tmp/codex-app.zip scratch/ChatGPT.app \
  && npm prune --omit=dev --ignore-scripts \
  && chmod -R a+rX /app

FROM ${NODE_IMAGE} AS runtime

ARG CODEX_VERSION=0.145.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    openssh-client \
    tini \
  && npm install --global "@openai/codex@${CODEX_VERSION}" \
  && useradd --create-home --shell /bin/bash --uid 10001 codex \
  && install -d -o codex -g codex -m 700 \
    /data \
    /home/codex/.ssh \
    /run/secrets/codex-ssh \
  && rm -rf /var/lib/apt/lists/* /root/.npm

WORKDIR /app

COPY --from=builder /app /app
COPY docker/entrypoint.sh /usr/local/bin/codex-web-entrypoint

ENV CODEX_CLI_PATH=/usr/local/bin/codex \
  CODEX_SSH_SOURCE_DIR=/run/secrets/codex-ssh \
  CODEX_WEB_DATA_DIR=/data \
  CODEX_WEB_HOST=0.0.0.0 \
  HOME=/home/codex \
  NODE_ENV=production \
  PORT=8080

USER codex

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '8080') + '/__backend/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/codex-web-entrypoint"]
