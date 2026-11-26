import type {
  AhpBackendRecord,
  ApiDistrictSummary,
  ApiRegionSummary,
  AsyncJobRecord,
  ComparisonEntry,
  DatasetReference,
  GeoJsonFeatureCollection,
  GisTileResult,
  MlRunResult,
  RegionShapExplanation,
  SolarAnalyzeResult,
  WindAnalyzeResult,
} from "@/types/greenmap";

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");
const API_BASE = RAW_API_BASE.replace(/\/api\/v1$/i, "").replace(/\/api$/i, "");

function collapseDuplicateApiPrefix(pathOrUrl: string): string {
  return pathOrUrl.replace(/(\/api\/v1)+(?=\/|$)/gi, "/api/v1");
}

export function buildApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    try {
      const parsed = new URL(path);
      parsed.pathname = collapseDuplicateApiPrefix(parsed.pathname);
      return parsed.toString();
    } catch {
      return collapseDuplicateApiPrefix(path);
    }
  }
  const cleanPath = collapseDuplicateApiPrefix(path.startsWith("/") ? path : `/${path}`);
  if (!API_BASE) return cleanPath;
  const joined = `${API_BASE}${cleanPath}`;
  if (/^https?:\/\//i.test(joined)) {
    return buildApiUrl(joined);
  }
  return collapseDuplicateApiPrefix(joined);
}

function looksLikeHtml(bodyText: string, contentType: string): boolean {
  if (contentType.includes("text/html")) return true;
  const trimmed = bodyText.trimStart().slice(0, 32).toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

async function parseJsonResponse<T>(resp: Response, url: string): Promise<T> {
  const contentType = (resp.headers.get("content-type") || "").toLowerCase();
  const rawText = await resp.text();

  if (!resp.ok) {
    let detail = `HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ""}`;
    if (contentType.includes("application/json") && rawText.trim()) {
      try {
        const errBody = JSON.parse(rawText) as { detail?: string; error?: string; message?: string };
        detail = errBody.detail || errBody.error || errBody.message || detail;
      } catch {
        // Keep HTTP status detail if JSON error body is malformed
      }
    } else if (looksLikeHtml(rawText, contentType)) {
      detail = `Backend API returned an HTML ${resp.status} page for ${url}. Ensure the FastAPI/Express server is running.`;
    } else if (rawText.trim()) {
      detail = `${detail}: ${rawText.trim().slice(0, 180)}`;
    }
    throw new Error(detail);
  }

  if (looksLikeHtml(rawText, contentType) || !contentType.includes("application/json")) {
    throw new Error(
      `Expected JSON from ${url} but received ${contentType || "non-JSON"} (${
        looksLikeHtml(rawText, contentType) ? "HTML application shell" : rawText.trim().slice(0, 80)
      }). Verify backend API routing and FastAPI availability.`
    );
  }

  try {
    return JSON.parse(rawText) as T;
  } catch (err) {
    throw new Error(
      `Invalid JSON received from ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function fetchSafeJson<T>(url: string, init?: RequestInit): Promise<T> {
  const targetUrl = buildApiUrl(url);
  const resp = await fetch(targetUrl, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return parseJsonResponse<T>(resp, targetUrl);
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  return fetchSafeJson<T>(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function downloadPdfReport(regionId: string): Promise<void> {
  const targetUrl = getPdfReportUrl(regionId);
  const resp = await fetch(targetUrl, {
    headers: { Accept: "application/pdf, application/json" },
  });
  const contentType = (resp.headers.get("content-type") || "").toLowerCase();

  if (!resp.ok) {
    const rawText = await resp.text();
    if (contentType.includes("application/json")) {
      try {
        const errBody = JSON.parse(rawText) as { detail?: string; error?: string };
        throw new Error(errBody.detail || errBody.error || `PDF export failed (HTTP ${resp.status})`);
      } catch (e) {
        if (e instanceof Error && !e.message.startsWith("Unexpected")) throw e;
      }
    }
    throw new Error(
      looksLikeHtml(rawText, contentType)
        ? `PDF export endpoint returned HTML (${resp.status}). Ensure FastAPI backend is running.`
        : `PDF export failed (HTTP ${resp.status}).`
    );
  }

  if (!contentType.includes("application/pdf")) {
    const rawText = await resp.text();
    throw new Error(
      looksLikeHtml(rawText, contentType)
        ? `PDF export returned an HTML page instead of a PDF document. Ensure FastAPI backend is running.`
        : `Expected application/pdf from ${targetUrl}, received ${contentType || "unknown"}.`
    );
  }

  const blob = await resp.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `greenmap-${regionId}-report.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function fetchBackendHealth() {
  return apiJson<{
    status: string;
    service: string;
    database: { engine: string; postgis_configured: boolean; postgis_connected: boolean };
  }>("/api/v1/health");
}

export function fetchRegions() {
  return apiJson<{ count: number; regions: ApiRegionSummary[] }>("/api/v1/regions");
}

export function fetchRegionsGeoJson() {
  return apiJson<GeoJsonFeatureCollection>("/api/v1/regions/geojson");
}

export function fetchDistricts(stateName?: string) {
  const qs = stateName ? `?state_name=${encodeURIComponent(stateName)}` : "";
  return apiJson<{ count: number; stateFilter: string | null; districts: ApiDistrictSummary[] }>(
    `/api/v1/districts${qs}`
  );
}

export function fetchDatasets() {
  return apiJson<{ count: number; datasets: DatasetReference[] }>("/api/v1/datasets");
}

export function fetchInstallationsGeoJson(fuel?: "Solar" | "Wind", stateName?: string) {
  const params = new URLSearchParams();
  if (fuel) params.set("fuel", fuel);
  if (stateName) params.set("state_name", stateName);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiJson<{ type: "FeatureCollection"; count: number; features: unknown[] }>(
    `/api/v1/installations${qs}`
  ) as Promise<GeoJsonFeatureCollection>;
}

export function runGisTile(payload: {
  region_id: string;
  solar_weights?: Record<string, number>;
  wind_weights?: Record<string, number>;
  grid_size?: number;
  max_solar_slope_deg?: number;
  max_wind_slope_deg?: number;
}) {
  return apiJson<GisTileResult>("/api/v1/gis/tile", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function analyzeSolar(regionId: string) {
  return apiJson<SolarAnalyzeResult>(`/api/v1/solar/analyze?region_id=${encodeURIComponent(regionId)}`);
}

export function analyzeWind(regionId: string, hubHeightM: number) {
  return apiJson<WindAnalyzeResult>(
    `/api/v1/wind/analyze?region_id=${encodeURIComponent(regionId)}&hub_height_m=${hubHeightM}`
  );
}

export function computeAhpBackend(payload: {
  scenario: "solar" | "wind";
  matrix: number[][];
  persist?: boolean;
}) {
  return apiJson<AhpBackendRecord>("/api/v1/ahp/compute", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchAhpDefaults() {
  return apiJson<{ solar: AhpBackendRecord; wind: AhpBackendRecord }>("/api/v1/ahp/defaults");
}

export function fetchAhpHistory(limit = 12) {
  return apiJson<{ configs: AhpBackendRecord[] }>(`/api/v1/ahp/history?limit=${limit}`);
}

export function fetchMlSummary(scenario: "hybrid" | "solar" | "wind" = "hybrid") {
  return apiJson<MlRunResult>(`/api/v1/ml/summary?scenario=${scenario}`);
}

export function trainMlBackend(scenario: "hybrid" | "solar" | "wind" = "hybrid", forceRebuild = false) {
  return apiJson<MlRunResult>("/api/v1/ml/train", {
    method: "POST",
    body: JSON.stringify({ scenario, force_rebuild: forceRebuild }),
  });
}

export function explainMlRegion(regionId: string) {
  return apiJson<RegionShapExplanation>(`/api/v1/ml/explain/${encodeURIComponent(regionId)}`);
}

export function compareRegionsApi(regionIds: string[]) {
  return apiJson<{ count: number; comparisons: ComparisonEntry[] }>("/api/v1/compare", {
    method: "POST",
    body: JSON.stringify({ region_ids: regionIds }),
  });
}

export function getPdfReportUrl(regionId: string): string {
  return buildApiUrl(`/api/v1/reports/${encodeURIComponent(regionId)}/pdf`);
}

export function enqueueGisJob(regionId: string, gridSize = 8) {
  return apiJson<AsyncJobRecord>("/api/v1/jobs/gis-tile", {
    method: "POST",
    body: JSON.stringify({ region_id: regionId, grid_size: gridSize }),
  });
}

export function enqueueMlJob(scenario: "hybrid" | "solar" | "wind" = "hybrid") {
  return apiJson<AsyncJobRecord>("/api/v1/jobs/ml-train", {
    method: "POST",
    body: JSON.stringify({ scenario, force_rebuild: false }),
  });
}

export function fetchJobs(limit = 20) {
  return apiJson<{ jobs: AsyncJobRecord[] }>(`/api/v1/jobs?limit=${limit}`);
}

export function fetchJob(jobId: string) {
  return apiJson<AsyncJobRecord>(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
}
