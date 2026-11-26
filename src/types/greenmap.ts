import type { GeoJSONSourceSpecification } from "maplibre-gl";

export type GeoJsonFeatureCollection = GeoJSONSourceSpecification["data"];

export type PageId =
  | "landing"
  | "dashboard"
  | "gis-explorer"
  | "solar-analysis"
  | "wind-analysis"
  | "ahp-calculator"
  | "ai-analytics"
  | "location-comparison"
  | "reports"
  | "methodology";

export type ResourceFocus = "solar" | "wind" | "hybrid";

export interface IndiaRegionRecord {
  id: string;
  name: string;
  stateCode: string;
  corridorName: string;
  focus: ResourceFocus;
  centroid: [number, number]; // [lon, lat]
  bbox: [number, number, number, number];
  elevationBand: string;
  terrainClass: string;
  publishedReferenceNote: string;
  publishedSolarPotentialGw: number | null;
  publishedWindPotentialGw: number | null;
  referenceSource: string;
  liveGisMetrics: {
    status: "awaiting_backend" | "connected";
    meanGhiKwhM2Day: number | null;
    meanWindSpeedMs: number | null;
    suitableAreaKm2: number | null;
    estimatedCapacityGw: number | null;
    ahpCompositeIndex: number | null;
    endpointHint: string;
  };
}

export interface ApiRegionSummary {
  id: string;
  name: string;
  stateCode: string;
  admLevel: "ADM1";
  areaKm2: number;
  centroid: [number, number];
  bbox: [number, number, number, number];
  focus: ResourceFocus;
  publishedSolarPotentialGw: number | null;
  publishedWindPotentialGw: number | null;
  wriVerifiedInstallations: {
    solarCount: number;
    solarCapacityMw: number;
    windCount: number;
    windCapacityMw: number;
  };
}

export interface ApiDistrictSummary {
  id: string;
  name: string;
  parentState: string;
  stateRegionId: string;
  admLevel: "ADM2";
  areaKm2: number;
  centroid: [number, number];
  bbox: [number, number, number, number];
  wriSolarPlants: number;
  wriSolarMw: number;
  wriWindPlants: number;
  wriWindMw: number;
}

export interface SuitabilityClassRow {
  classId: number;
  label: string;
  range: string;
  color: string;
  cellCount: number;
  areaKm2: number;
  estimatedCapacityMw: number;
}

export interface NasaMonthlyPoint {
  month: string;
  ghi: number;
  dni: number;
  ws50m: number;
  ws100m: number;
  ws120m: number;
  wpd100m: number;
  t2m: number;
  precipMmDay: number;
  pvDailyKwhKwp: number;
}

export interface GisTileResult {
  region: {
    id: string;
    name: string;
    admLevel: string;
    parentState: string;
    areaKm2: number;
    centroid: [number, number];
    bbox: [number, number, number, number];
  };
  crs: {
    storage: string;
    projectedMetric: string;
    cellSpacingMeters: [number, number];
  };
  pipelineStepsExecuted: string[];
  resourceSummary: {
    meanGhiKwhM2Day: number;
    meanWs100mMs: number;
    meanElevationM: number;
    meanSlopeDeg: number;
    meanAspectDeg: number;
    meanDistPowerKm: number;
    meanDistRoadKm: number;
    pvSpecificYieldKwhKwpYr: number | null;
    wpd100mWM2: number | null;
  };
  solarSuitability: {
    suitableLandAreaKm2: number;
    estimatedCapacityGw: number;
    meanAhpScore: number;
    packingFactorMwPerKm2: number;
    classes: SuitabilityClassRow[];
  };
  windSuitability: {
    suitableLandAreaKm2: number;
    estimatedCapacityGw: number;
    meanAhpScore: number;
    packingFactorMwPerKm2: number;
    classes: SuitabilityClassRow[];
  };
  nasaClimatology: {
    status: string;
    source: string;
    annual: Record<string, number> | null;
    monthly: NasaMonthlyPoint[];
  };
  sentinel2Verification: {
    status: string;
    collection: string;
    matchedScenes: number;
    sampleScenes: Array<{
      id: string;
      datetime: string;
      cloudCoverPct: number;
      platform: string;
    }>;
  };
  osmInfrastructure: {
    status: string;
    counts: {
      substations?: number;
      highwayNodes?: number;
      exclusionFeatures?: number;
    };
    wriNearbyPlants: number;
  };
  rasterOutputs: Record<string, string>;
  suitabilityGeoJson: GeoJsonFeatureCollection;
}

export interface SolarAnalyzeResult {
  region: GisTileResult["region"];
  solarSuitability: GisTileResult["solarSuitability"];
  resourceSummary: GisTileResult["resourceSummary"];
  nasaMonthly: NasaMonthlyPoint[];
  nasaStatus: string;
  sentinel2Verification: GisTileResult["sentinel2Verification"];
  crs: GisTileResult["crs"];
}

export interface WindAnalyzeResult {
  region: GisTileResult["region"];
  selectedHubHeightM: number;
  windSuitability: GisTileResult["windSuitability"];
  resourceSummary: GisTileResult["resourceSummary"];
  shearProfile: Array<{ heightM: number; windSpeedMs: number; wpdWM2: number }>;
  nasaMonthly: NasaMonthlyPoint[];
  nasaStatus: string;
  crs: GisTileResult["crs"];
}

export interface GisLayerConfig {
  id: string;
  label: string;
  category: "vector" | "solar" | "wind" | "terrain" | "infrastructure";
  visible: boolean;
  opacity: number;
  dataStatus: "local_geojson" | "awaiting_raster_api" | "connected";
  sourceProvider: string;
  resolution: string;
  legendRange: string;
  legendColors: string[];
}

export interface AhpCriterion {
  id: string;
  code: string;
  name: string;
  gisLayerRef: string;
  unit: string;
  description: string;
}

export interface AhpCalculationResult {
  weights: number[];
  lambdaMax: number;
  ci: number;
  ri: number;
  cr: number;
  isConsistent: boolean;
}

export interface AhpBackendRecord {
  config_id: string;
  scenario: "solar" | "wind";
  matrix: number[][];
  weights: Record<string, number>;
  lambda_max: number;
  ci: number;
  cr: number;
  is_consistent: boolean;
  warning?: string | null;
  created_at: string;
}

export interface MlModelCvMetrics {
  meanRocAuc: number;
  meanF1: number;
  meanAccuracy: number;
  meanBalancedAccuracy: number;
  evaluatedCount: number;
  folds: Array<{
    fold: number;
    nTest: number;
    rocAuc: number;
    f1: number;
    accuracy: number;
    balancedAccuracy: number;
  }>;
}

export interface MlRunResult {
  run_id: string;
  scenario: string;
  dataset_source: string;
  sample_count: number;
  positive_count?: number;
  background_count?: number;
  spatial_cv_scheme?: string;
  label_methodology_note?: string;
  metrics: {
    randomForest: MlModelCvMetrics;
    xgboost: MlModelCvMetrics;
  };
  shap: {
    explainer: string;
    baseValue: number;
    globalFeatures: Array<{
      feature: string;
      label: string;
      meanAbsShap: number;
      relativeImportancePct: number;
      direction: "positive" | "negative";
    }>;
  };
  clusters: Array<{
    clusterId: number;
    regimeName: string;
    sampleCount: number;
    verifiedPlantSharePct: number;
    meanGhi: number;
    meanWs100m: number;
    meanElevationM: number;
    meanSlopeDeg: number;
    meanDistInfraKm: number;
  }>;
  ahp_comparison: {
    pearsonR: number;
    pearsonPValue: number;
    spearmanRho: number;
    exact5ClassAgreementPct: number;
    withinOneClassAgreementPct: number;
    samplePoints: Array<{
      name: string;
      fuelType: string;
      stateName: string;
      ahpScore: number;
      xgbSuitabilityProb: number;
      rfSuitabilityProb: number;
      clusterId: number;
      ghi: number;
      ws100m: number;
    }>;
  };
  created_at: string;
}

export interface RegionShapExplanation {
  regionId: string;
  xgbSuitabilityProb: number;
  rfSuitabilityProb: number;
  localShap: Array<{
    feature: string;
    label: string;
    value: number;
    shapContribution: number;
  }>;
}

export interface ComparisonEntry {
  region: GisTileResult["region"];
  resourceSummary: GisTileResult["resourceSummary"];
  solarSuitability: {
    suitableLandAreaKm2: number;
    estimatedCapacityGw: number;
    meanAhpScore: number;
    classes: SuitabilityClassRow[];
  };
  windSuitability: {
    suitableLandAreaKm2: number;
    estimatedCapacityGw: number;
    meanAhpScore: number;
    classes: SuitabilityClassRow[];
  };
  sentinel2MatchedScenes: number;
  osmCounts: Record<string, number>;
}

export interface AsyncJobRecord {
  job_id: string;
  job_type: string;
  status: "queued" | "running" | "completed" | "failed";
  region_id: string | null;
  config: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface AnalysisJobDraft {
  id: string;
  title: string;
  regionId: string;
  regionName: string;
  module: "Solar PV" | "Wind 100m" | "AHP Overlay" | "Site Comparison";
  createdAt: string;
  status: "queued_for_backend" | "schema_ready";
  apiEndpoint: string;
  payloadSummary: string;
}

export interface DatasetReference {
  id: string;
  name: string;
  provider: string;
  spatialResolution: string;
  temporalCoverage: string;
  parameters: string[];
  format: string;
  integrationEndpoint: string;
  licenseType: string;
  limitations?: string;
  status?: string;
}
