import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  uid: text("uid").notNull().unique(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const indiaRegions = pgTable("india_regions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  stateCode: text("state_code").notNull(),
  corridorName: text("corridor_name").notNull(),
  focus: text("focus").notNull(),
  centroidLon: doublePrecision("centroid_lon").notNull(),
  centroidLat: doublePrecision("centroid_lat").notNull(),
  bboxJson: jsonb("bbox_json").$type<number[]>().notNull(),
  elevationBand: text("elevation_band").notNull(),
  terrainClass: text("terrain_class").notNull(),
  publishedSolarGw: doublePrecision("published_solar_gw"),
  publishedWindGw: doublePrecision("published_wind_gw"),
  referenceSource: text("reference_source").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const indiaDistricts = pgTable("india_districts", {
  id: text("id").primaryKey(),
  regionId: text("region_id")
    .references(() => indiaRegions.id)
    .notNull(),
  districtName: text("district_name").notNull(),
  stateCode: text("state_code").notNull(),
  centroidLon: doublePrecision("centroid_lon").notNull(),
  centroidLat: doublePrecision("centroid_lat").notNull(),
  bboxJson: jsonb("bbox_json").$type<number[]>().notNull(),
  areaKm2: doublePrecision("area_km2").notNull(),
  tileId: text("tile_id").notNull(),
  agroClimaticZone: text("agro_climatic_zone").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ahpScenarios = pgTable("ahp_scenarios", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  name: text("name").notNull(),
  resourceType: text("resource_type").notNull(),
  matrixJson: jsonb("matrix_json").$type<number[][]>().notNull(),
  weightsJson: jsonb("weights_json").$type<Record<string, number>>().notNull(),
  lambdaMax: doublePrecision("lambda_max").notNull(),
  ci: doublePrecision("ci").notNull(),
  cr: doublePrecision("cr").notNull(),
  isConsistent: boolean("is_consistent").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const analysisJobs = pgTable("analysis_jobs", {
  id: text("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  jobType: text("job_type").notNull(),
  regionId: text("region_id").notNull(),
  districtId: text("district_id"),
  resourceType: text("resource_type").notNull(),
  status: text("status").notNull(),
  progress: integer("progress").notNull().default(0),
  configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull(),
  resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const mlExperiments = pgTable("ml_experiments", {
  id: text("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  regionId: text("region_id").notNull(),
  resourceType: text("resource_type").notNull(),
  modelType: text("model_type").notNull(),
  cvFolds: integer("cv_folds").notNull(),
  metricsJson: jsonb("metrics_json").$type<Record<string, unknown>>().notNull(),
  shapSummaryJson: jsonb("shap_summary_json").$type<Record<string, unknown>>().notNull(),
  ahpComparisonJson: jsonb("ahp_comparison_json").$type<Record<string, unknown>>().notNull(),
  trainingNotes: text("training_notes").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  title: text("title").notNull(),
  regionId: text("region_id").notNull(),
  districtId: text("district_id"),
  analysisJobId: text("analysis_job_id"),
  ahpScenarioId: integer("ahp_scenario_id"),
  mlExperimentId: text("ml_experiment_id"),
  summaryJson: jsonb("summary_json").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const datasetCatalog = pgTable("dataset_catalog", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  spatialResolution: text("spatial_resolution").notNull(),
  temporalCoverage: text("temporal_coverage").notNull(),
  parametersJson: jsonb("parameters_json").$type<string[]>().notNull(),
  format: text("format").notNull(),
  integrationEndpoint: text("integration_endpoint").notNull(),
  licenseType: text("license_type").notNull(),
  limitations: text("limitations").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  ahpScenarios: many(ahpScenarios),
  analysisJobs: many(analysisJobs),
  mlExperiments: many(mlExperiments),
  reports: many(reports),
}));

export const indiaRegionsRelations = relations(indiaRegions, ({ many }) => ({
  districts: many(indiaDistricts),
}));

export const indiaDistrictsRelations = relations(indiaDistricts, ({ one }) => ({
  region: one(indiaRegions, {
    fields: [indiaDistricts.regionId],
    references: [indiaRegions.id],
  }),
}));
