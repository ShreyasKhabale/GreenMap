-- GreenMap PostgreSQL + PostGIS Spatial Schema
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS admin_regions (
    id TEXT PRIMARY KEY,
    adm_level TEXT NOT NULL CHECK (adm_level IN ('ADM1', 'ADM2')),
    name TEXT NOT NULL,
    parent_state TEXT,
    iso_code TEXT,
    area_km2 DOUBLE PRECISION NOT NULL,
    centroid_lon DOUBLE PRECISION NOT NULL,
    centroid_lat DOUBLE PRECISION NOT NULL,
    bbox_json JSONB NOT NULL,
    geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_regions_geom
    ON admin_regions USING GIST (geom);

CREATE TABLE IF NOT EXISTS power_installations (
    gppd_idnr TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    primary_fuel TEXT NOT NULL CHECK (primary_fuel IN ('Solar', 'Wind')),
    capacity_mw DOUBLE PRECISION NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    commissioning_year DOUBLE PRECISION,
    source TEXT,
    state_name TEXT,
    district_name TEXT,
    geom GEOMETRY(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_power_installations_geom
    ON power_installations USING GIST (geom);

CREATE TABLE IF NOT EXISTS nasa_power_cache (
    cache_key TEXT PRIMARY KEY,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    payload_json JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ahp_configurations (
    config_id TEXT PRIMARY KEY,
    scenario TEXT NOT NULL CHECK (scenario IN ('solar', 'wind')),
    matrix_json JSONB NOT NULL,
    weights_json JSONB NOT NULL,
    lambda_max DOUBLE PRECISION NOT NULL,
    ci DOUBLE PRECISION NOT NULL,
    cr DOUBLE PRECISION NOT NULL,
    is_consistent BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analysis_jobs (
    job_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    region_id TEXT,
    config_json JSONB NOT NULL,
    result_json JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ml_model_runs (
    run_id TEXT PRIMARY KEY,
    scenario TEXT NOT NULL,
    dataset_source TEXT NOT NULL,
    sample_count INTEGER NOT NULL,
    metrics_json JSONB NOT NULL,
    shap_json JSONB NOT NULL,
    clusters_json JSONB NOT NULL,
    ahp_comparison_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
