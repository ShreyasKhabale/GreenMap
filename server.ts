import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { execFileSync, spawn, type ChildProcess } from "child_process";

// In AI Studio dev behind nginx, DEFAULT_APP_PORT=3000 is set; in standard Cloud Run containers, PORT (default 8080) is set.
const PORT = Number(process.env.DEFAULT_APP_PORT || process.env.PORT || 3000);
const FASTAPI_PORT = Number(process.env.FASTAPI_PORT || 8001);
const RAW_FASTAPI_BASE_URL = (
  process.env.FASTAPI_BASE_URL ||
  process.env.BACKEND_API_URL ||
  ""
).trim();

const FASTAPI_BASE_URL = (
  RAW_FASTAPI_BASE_URL || `http://127.0.0.1:${FASTAPI_PORT}`
)
  .replace(/\/+$/, "")
  .replace(/\/api\/v1$/i, "")
  .replace(/\/api$/i, "");

function isLocalFastApiTarget(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return ["127.0.0.1", "localhost", "0.0.0.0", "::1"].includes(parsed.hostname.toLowerCase());
  } catch {
    return true;
  }
}

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/about-carto/">CARTO</a>';

const CARTO_UPSTREAM_HOSTS = {
  base: "https://basemaps.cartocdn.com",
  tiles: "https://tiles.basemaps.cartocdn.com",
} as const;

const CARTO_VECTOR_STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

let fastapiProc: ChildProcess | null = null;
let fastapiLastError: string | null = null;

function sanitizeErrorText(raw: string): string {
  return raw
    .replace(/(postgres(?:ql)?:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, "$1***:***@")
    .replace(/(password\s*=\s*)(\S+)/gi, "$1***")
    .replace(/(CARTO_API_KEY\s*=\s*)(\S+)/gi, "$1***");
}

function resolveUvicornBinary(): string | null {
  const candidates = [
    process.env.GREENMAP_UVICORN_BIN,
    "/opt/greenmap-venv/bin/uvicorn",
    path.resolve(import.meta.dirname, ".venv/bin/uvicorn"),
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const resolved = execFileSync("which", ["uvicorn"], { encoding: "utf8" }).trim();
    if (resolved && fs.existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // uvicorn not on PATH
  }
  return null;
}

function getLocalSidecarPort(): number {
  try {
    const parsed = new URL(FASTAPI_BASE_URL);
    if (parsed.port) return Number(parsed.port);
  } catch {
    // Fallback to FASTAPI_PORT
  }
  return FASTAPI_PORT;
}

function startFastApiSidecar(): void {
  if (RAW_FASTAPI_BASE_URL && !isLocalFastApiTarget(FASTAPI_BASE_URL)) {
    console.log(`Using external FastAPI backend at ${FASTAPI_BASE_URL}`);
    return;
  }
  const uvicornBin = resolveUvicornBinary();
  if (!uvicornBin) {
    fastapiLastError =
      "Prebuilt uvicorn binary not found in GREENMAP_UVICORN_BIN, /opt/greenmap-venv/bin/uvicorn, .venv/bin/uvicorn, or PATH.";
    console.error(`FastAPI sidecar startup failed: ${fastapiLastError}`);
    return;
  }
  if (fastapiProc) return;

  const sidecarPort = getLocalSidecarPort();
  fastapiLastError = null;
  console.log(`Starting FastAPI sidecar via ${uvicornBin} on 127.0.0.1:${sidecarPort}...`);
  fastapiProc = spawn(
    uvicornBin,
    ["backend.app.main:app", "--host", "127.0.0.1", "--port", String(sidecarPort)],
    {
      cwd: import.meta.dirname,
      env: { ...process.env, PYTHONPATH: import.meta.dirname, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  fastapiProc.stdout?.on("data", (chunk) => {
    process.stdout.write(`[fastapi] ${chunk}`);
  });
  fastapiProc.stderr?.on("data", (chunk) => {
    const text = sanitizeErrorText(String(chunk));
    if (text.toLowerCase().includes("error") || text.toLowerCase().includes("traceback")) {
      fastapiLastError = text.trim().slice(-400);
    }
    process.stderr.write(`[fastapi] ${text}`);
  });
  fastapiProc.on("error", (err) => {
    fastapiLastError = sanitizeErrorText(err.message);
    console.error("Failed to spawn FastAPI sidecar:", fastapiLastError);
  });
  fastapiProc.on("exit", (code) => {
    console.warn(`FastAPI sidecar exited with code ${code}`);
    if (code && code !== 0 && !fastapiLastError) {
      fastapiLastError = `FastAPI sidecar exited with code ${code}`;
    }
    fastapiProc = null;
  });
}

async function checkFastApiHealth(): Promise<{
  online: boolean;
  databaseEngine?: string;
  postgisConnected?: boolean;
  databaseError?: string | null;
}> {
  try {
    const resp = await fetch(`${FASTAPI_BASE_URL}/api/v1/health`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = (await resp.json()) as {
      database?: {
        engine?: string;
        postgis_connected?: boolean;
        postgis_error?: string | null;
      };
      error?: string;
    };
    return {
      online: resp.ok,
      databaseEngine: data.database?.engine,
      postgisConnected: data.database?.postgis_connected,
      databaseError: data.database?.postgis_error
        ? sanitizeErrorText(data.database.postgis_error)
        : data.error
          ? sanitizeErrorText(data.error)
          : null,
    };
  } catch (err) {
    return {
      online: false,
      databaseError: err instanceof Error ? sanitizeErrorText(err.message) : "FastAPI unreachable",
    };
  }
}

async function waitForFastApiReadiness(maxAttempts = 20, intervalMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const health = await checkFastApiHealth();
    if (health.online) {
      console.log(
        `FastAPI sidecar ready on ${FASTAPI_BASE_URL} (database: ${health.databaseEngine ?? "unknown"}, postgis: ${Boolean(health.postgisConnected)})`
      );
      return;
    }
    if (attempt === maxAttempts) {
      console.error(
        `FastAPI readiness check did not pass within ${maxAttempts}s: ${health.databaseError || fastapiLastError || "backend not responding"}`
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function getCartoApiKey(): string {
  return (process.env.CARTO_API_KEY || "").trim();
}

function appendCartoKey(rawUrl: string, apiKey: string): string {
  if (!apiKey) return rawUrl;
  const separator = rawUrl.includes("?") ? "&" : "?";
  return `${rawUrl}${separator}key=${encodeURIComponent(apiKey)}`;
}

function rewriteCartoUrlToProxy(rawUrl: string): string {
  if (rawUrl.startsWith(CARTO_UPSTREAM_HOSTS.tiles)) {
    const rest = rawUrl.slice(CARTO_UPSTREAM_HOSTS.tiles.length);
    return `/api/basemap/carto/tiles${rest}`;
  }
  if (rawUrl.startsWith(CARTO_UPSTREAM_HOSTS.base)) {
    const rest = rawUrl.slice(CARTO_UPSTREAM_HOSTS.base.length);
    return `/api/basemap/carto/base${rest}`;
  }
  return rawUrl;
}

interface CartoStatusCache {
  checkedAt: number;
  keyConfigured: boolean;
  watermarkFree: boolean;
  upstreamStatus: number;
}

let statusCache: CartoStatusCache | null = null;

async function verifyCartoWatermarkStatus(): Promise<CartoStatusCache> {
  const apiKey = getCartoApiKey();
  const now = Date.now();
  if (statusCache && now - statusCache.checkedAt < 60_000 && statusCache.keyConfigured === Boolean(apiKey)) {
    return statusCache;
  }

  if (!apiKey) {
    statusCache = {
      checkedAt: now,
      keyConfigured: false,
      watermarkFree: false,
      upstreamStatus: 0,
    };
    return statusCache;
  }

  try {
    const probeUrl = appendCartoKey(
      "https://basemaps.cartocdn.com/dark_all/4/11/7@2x.png",
      apiKey
    );
    const resp = await fetch(probeUrl, { method: "HEAD" });
    const etag = resp.headers.get("etag") || "";
    const isWatermarked = etag.replace(/"/g, "").startsWith("wm-");
    statusCache = {
      checkedAt: now,
      keyConfigured: true,
      watermarkFree: resp.ok && !isWatermarked,
      upstreamStatus: resp.status,
    };
  } catch {
    statusCache = {
      checkedAt: now,
      keyConfigured: true,
      watermarkFree: false,
      upstreamStatus: 502,
    };
  }

  return statusCache;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/livez", (_req, res) => {
    res.status(200).json({ status: "ok", port: PORT });
  });

  app.get("/healthz", async (_req, res) => {
    const fastapiHealth = await checkFastApiHealth();
    const ready = fastapiHealth.online;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "unavailable",
      express: "ok",
      port: PORT,
      fastapi: {
        online: fastapiHealth.online,
        sidecarActive: Boolean(fastapiProc),
        lastError: fastapiLastError,
      },
      database: {
        engine: fastapiHealth.databaseEngine ?? null,
        postgisConnected: fastapiHealth.postgisConnected ?? false,
        error: fastapiHealth.databaseError ?? null,
      },
    });
  });

  // Proxy /api/v1/* to Python FastAPI GIS/AHP/ML backend
  app.use("/api/v1", async (req, res) => {
    const normalizedPath = req.originalUrl.replace(/^(\/api\/v1)+(?=\/|$)/i, "/api/v1");
    const targetUrl = `${FASTAPI_BASE_URL}${normalizedPath}`;
    try {
      const headers: Record<string, string> = {};
      if (req.headers["content-type"]) {
        headers["content-type"] = String(req.headers["content-type"]);
      }
      const hasBody = !["GET", "HEAD"].includes(req.method.toUpperCase());
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: hasBody && req.body ? JSON.stringify(req.body) : undefined,
        signal: AbortSignal.timeout(120_000),
      });

      const contentType = upstream.headers.get("content-type") || "application/json";
      const contentDisp = upstream.headers.get("content-disposition");
      const buf = Buffer.from(await upstream.arrayBuffer());

      // Never leak upstream HTML error pages to JSON API clients
      if (!upstream.ok && contentType.toLowerCase().includes("text/html")) {
        return res.status(upstream.status).json({
          error: `Upstream FastAPI backend returned HTML error (${upstream.status}).`,
          path: req.originalUrl,
        });
      }

      res.status(upstream.status);
      res.setHeader("Content-Type", contentType);
      if (contentDisp) {
        res.setHeader("Content-Disposition", contentDisp);
      }
      return res.send(buf);
    } catch (err) {
      return res.status(503).json({
        error: "Python FastAPI GIS/ML backend is currently unavailable.",
        detail: err instanceof Error ? sanitizeErrorText(err.message) : sanitizeErrorText(String(err)),
        fastapiLastError,
        targetBase: FASTAPI_BASE_URL,
      });
    }
  });

  // Secure server-side basemap status endpoint (never exposes CARTO_API_KEY)
  app.get("/api/basemap/status", async (_req, res) => {
    const [probe, fastapiHealth] = await Promise.all([
      verifyCartoWatermarkStatus(),
      checkFastApiHealth(),
    ]);
    res.json({
      provider: "CARTO",
      keyConfigured: probe.keyConfigured,
      watermarkFree: probe.watermarkFree,
      upstreamStatus: probe.upstreamStatus,
      attribution: "© OpenStreetMap contributors © CARTO",
      gisBackendStatus: fastapiHealth.online ? "connected" : "pending",
      databaseEngine: fastapiHealth.databaseEngine ?? null,
      databaseError: fastapiHealth.databaseError ?? null,
      fastapiSidecarActive: Boolean(fastapiProc),
      fastapiLastError,
      rasterCogStatus: fastapiHealth.online ? "geotiff_active" : "pending",
    });
  });

  // Authenticated CARTO Vector Style JSON endpoint (rewrites tiles, glyphs, sprites through server proxy)
  app.get("/api/basemap/style/:themeFile", async (req, res) => {
    const theme = req.params.themeFile.replace(/\.json$/i, "");
    if (theme !== "dark" && theme !== "light") {
      return res.status(400).json({ error: "Invalid basemap style theme. Use dark.json or light.json." });
    }

    const apiKey = getCartoApiKey();
    const upstreamStyleUrl = appendCartoKey(CARTO_VECTOR_STYLES[theme], apiKey);

    try {
      const upstream = await fetch(upstreamStyleUrl);
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: "Failed to fetch CARTO vector style." });
      }

      const styleJson = (await upstream.json()) as {
        sources?: Record<string, { tiles?: string[]; url?: string; attribution?: string }>;
        sprite?: string;
        glyphs?: string;
      };

      if (styleJson.sources) {
        for (const source of Object.values(styleJson.sources)) {
          if (Array.isArray(source.tiles)) {
            source.tiles = source.tiles.map(rewriteCartoUrlToProxy);
          }
          if (typeof source.url === "string") {
            source.url = rewriteCartoUrlToProxy(source.url);
          }
          if (!source.attribution) {
            source.attribution = CARTO_ATTRIBUTION;
          }
        }
      }

      if (typeof styleJson.sprite === "string") {
        styleJson.sprite = rewriteCartoUrlToProxy(styleJson.sprite);
      }
      if (typeof styleJson.glyphs === "string") {
        styleJson.glyphs = rewriteCartoUrlToProxy(styleJson.glyphs);
      }

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("X-Carto-Auth", apiKey ? "authenticated" : "unauthenticated");
      return res.json(styleJson);
    } catch (err) {
      console.error("CARTO style proxy error:", err);
      return res.status(502).json({ error: "Unable to load CARTO basemap style." });
    }
  });

  // Authenticated CARTO Raster Tile fallback endpoint
  app.get("/api/basemap/raster/:theme/:z/:x/:yFile", async (req, res) => {
    const { theme, z, x, yFile } = req.params;
    if (theme !== "dark_all" && theme !== "light_all") {
      return res.status(400).json({ error: "Invalid raster basemap theme." });
    }
    if (!/^\d{1,2}$/.test(z) || !/^\d{1,6}$/.test(x) || !/^\d{1,6}(@2x)?\.png$/.test(yFile)) {
      return res.status(400).json({ error: "Invalid tile coordinates." });
    }

    const apiKey = getCartoApiKey();
    const targetUrl = appendCartoKey(
      `${CARTO_UPSTREAM_HOSTS.base}/${theme}/${z}/${x}/${yFile}`,
      apiKey
    );

    try {
      const upstream = await fetch(targetUrl);
      const etag = (upstream.headers.get("etag") || "").replace(/"/g, "");
      const contentType = upstream.headers.get("content-type") || "image/png";
      const buffer = Buffer.from(await upstream.arrayBuffer());

      res.status(upstream.status);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-Carto-Watermark", etag.startsWith("wm-") ? "present" : "none");
      return res.send(buffer);
    } catch (err) {
      console.error("CARTO raster proxy error:", err);
      return res.status(502).json({ error: "Failed to proxy CARTO raster tile." });
    }
  });

  // Authenticated CARTO Vector Tile / Glyph / Sprite Proxy (strict host allowlist)
  app.get("/api/basemap/carto/:hostKey/*", async (req, res) => {
    const hostKey = req.params.hostKey as keyof typeof CARTO_UPSTREAM_HOSTS;
    const baseHost = CARTO_UPSTREAM_HOSTS[hostKey];
    if (!baseHost) {
      return res.status(400).json({ error: "Invalid CARTO asset host key." });
    }

    const wildcardPath = (req.params as Record<string, string>)[0] || "";
    if (!wildcardPath || wildcardPath.includes("..") || wildcardPath.includes("://")) {
      return res.status(400).json({ error: "Invalid CARTO asset path." });
    }

    const queryIndex = req.originalUrl.indexOf("?");
    const rawQuery = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
    const apiKey = getCartoApiKey();
    const upstreamUrl = appendCartoKey(`${baseHost}/${wildcardPath}${rawQuery}`, apiKey);

    try {
      const upstream = await fetch(upstreamUrl);
      const etag = (upstream.headers.get("etag") || "").replace(/"/g, "");
      const contentType = upstream.headers.get("content-type") || "application/octet-stream";

      if (contentType.includes("application/json") && !wildcardPath.includes("sprite")) {
        const jsonBody = (await upstream.json()) as { tiles?: string[]; [key: string]: unknown };
        if (Array.isArray(jsonBody.tiles)) {
          jsonBody.tiles = jsonBody.tiles.map(rewriteCartoUrlToProxy);
        }
        res.status(upstream.status);
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("X-Carto-Auth", apiKey ? "authenticated" : "unauthenticated");
        res.setHeader("X-Carto-Watermark", etag.startsWith("wm-") ? "present" : "none");
        return res.json(jsonBody);
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());

      res.status(upstream.status);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-Carto-Auth", apiKey ? "authenticated" : "unauthenticated");
      res.setHeader("X-Carto-Watermark", etag.startsWith("wm-") ? "present" : "none");
      return res.send(buffer);
    } catch (err) {
      console.error("CARTO asset proxy error:", err);
      return res.status(502).json({ error: "Failed to proxy CARTO basemap asset." });
    }
  });

  // Never allow unmatched /api/* routes to fall through to Vite or SPA index.html
  app.use("/api", (req, res) => {
    return res.status(404).json({
      error: "API endpoint not found.",
      path: req.originalUrl,
    });
  });

  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      const indexFile = path.join(distDir, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send("Build artifacts not found.");
      }
    });
  }

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`GreenMap server running on http://0.0.0.0:${PORT}`);
    // Start FastAPI sidecar after Express/Vite is listening so startup probes succeed immediately
    setImmediate(() => {
      startFastApiSidecar();
      void waitForFastApiReadiness();
    });
  });

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}; shutting down GreenMap server...`);
    if (fastapiProc && !fastapiProc.killed) {
      fastapiProc.kill("SIGTERM");
    }
    httpServer.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

startServer();
