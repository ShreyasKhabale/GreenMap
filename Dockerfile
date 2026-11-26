# GreenMap Production Container (Node.js 22 + Python 3.11 FastAPI GIS/ML Sidecar)
FROM node:22-bookworm-slim

ENV PORT=8080 \
    FASTAPI_PORT=8001 \
    GREENMAP_UVICORN_BIN=/opt/greenmap-venv/bin/uvicorn \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install Python 3.11, venv tooling, TLS certificates, curl (for healthcheck), and native runtime libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    ca-certificates \
    curl \
    libexpat1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Create pre-built Python virtual environment during image creation (never at runtime)
COPY backend/requirements.txt /app/backend/requirements.txt
RUN python3 -m venv /opt/greenmap-venv \
    && /opt/greenmap-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/greenmap-venv/bin/pip install --no-cache-dir -r /app/backend/requirements.txt \
    && chmod -R a+rX /opt/greenmap-venv

# Install Node.js dependencies (including vite/typescript devDependencies) and build production bundle
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html server.ts ./
COPY public ./public
COPY src ./src
COPY backend ./backend

RUN npm run build \
    && npm prune --omit=dev

ENV NODE_ENV=production

# Create non-root runtime user and grant writable cache directory permissions
RUN groupadd -r appuser \
    && useradd -r -g appuser -m -d /home/appuser appuser \
    && mkdir -p /app/backend/data_cache/rasters /app/backend/data_cache/tile_results /app/backend/data_cache/osm_cache \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["npm", "run", "start"]
