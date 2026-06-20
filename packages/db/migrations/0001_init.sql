-- Forge Hill Land Analyzer — initial schema (PostgreSQL + PostGIS)
-- Target: Aurora Serverless v2 PostgreSQL >= 16.3 (required for scale-to-zero).
--
-- Design notes baked in (see ARCHITECTURE.md):
--   * The stable cache unit is the PARCEL, keyed on the authoritative MassGIS L3
--     parcel id (loc_id), NOT the listing address. Address-keying corrupts the
--     "never re-research" cache (raw land often has no street address). Listings
--     are resolved to parcels spatially (geocode -> point-in-polygon vs L3).
--   * Listings that don't resolve to exactly one parcel are kept with
--     parcel_id = NULL and surfaced for human review.
--   * The full vendor payload is stored verbatim (raw jsonb) so we can re-parse
--     without re-fetching.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE parcel_resolution AS ENUM ('l3', 'address', 'unresolved');
CREATE TYPE research_kind AS ENUM (
  'zoning', 'topo', 'flood', 'wetlands', 'ownership', 'cma', 'feasibility'
);
CREATE TYPE confidence AS ENUM ('high', 'medium', 'low');

-- ---------------------------------------------------------------------------
-- parcels — the stable unit research is cached against
-- ---------------------------------------------------------------------------
CREATE TABLE parcels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loc_id        text,                       -- MassGIS L3 LOC_ID (authoritative key)
  apn           text,                       -- assessor parcel id (MAP_PAR_ID) when resolved
  resolution    parcel_resolution NOT NULL DEFAULT 'unresolved',

  address       text,
  city          text,
  state         text NOT NULL DEFAULT 'MA',
  zip           text,

  geom          geometry(Point, 4326),      -- centroid / geocoded point
  lot_geom      geometry(Polygon, 4326),    -- parcel boundary from L3 (when resolved)
  lot_acres     numeric,
  lot_sqft      numeric,

  zoning_code   text,
  zoning_source text,

  -- Selected L3 assessor attributes captured at resolution time (owner, values,
  -- use code, last sale) live in research_cache(kind='ownership'); the parcel
  -- row keeps only the stable identity + geometry.

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One parcel per L3 id. Address is a fallback identity only (normalized), so it
-- is NOT globally unique here — a vague/absent address must never merge parcels.
CREATE UNIQUE INDEX parcels_loc_id_key ON parcels (loc_id) WHERE loc_id IS NOT NULL;
CREATE INDEX parcels_geom_gix ON parcels USING gist (geom);
CREATE INDEX parcels_city_idx ON parcels (city);

-- ---------------------------------------------------------------------------
-- listings — an MLS PIN record (many listings map to one parcel over time)
-- ---------------------------------------------------------------------------
CREATE TABLE listings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id        uuid REFERENCES parcels(id) ON DELETE SET NULL, -- NULL = unresolved
  mls_listing_key  text NOT NULL UNIQUE,     -- RESO ListingKey
  mls_listing_id   text,                     -- human MLS number

  standard_status  text NOT NULL,            -- RESO StandardStatus
  mls_status       text,
  property_type    text,
  property_subtype text,

  list_price       numeric,
  original_list_price numeric,
  close_price      numeric,

  dom              integer,
  list_date        date,
  close_date       date,
  modification_ts  timestamptz NOT NULL,     -- RESO ModificationTimestamp (watermark)

  lot_acres        numeric,
  lot_sqft         numeric,
  latitude         numeric,
  longitude        numeric,

  raw              jsonb NOT NULL,           -- full provider payload

  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX listings_parcel_idx ON listings (parcel_id);
CREATE INDEX listings_modification_idx ON listings (modification_ts);
CREATE INDEX listings_status_idx ON listings (standard_status);
CREATE INDEX listings_unresolved_idx ON listings (id) WHERE parcel_id IS NULL;

-- ---------------------------------------------------------------------------
-- research_cache — the "never re-research" core
-- ---------------------------------------------------------------------------
CREATE TABLE research_cache (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id           uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  kind                research_kind NOT NULL,
  payload             jsonb NOT NULL,         -- structured result for this kind
  sources             jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{title,url,publisher,retrievedAt}]
  confidence          confidence NOT NULL DEFAULT 'low',
  needs_human         boolean NOT NULL DEFAULT false,
  needs_human_reasons text[] NOT NULL DEFAULT '{}',
  generated_at        timestamptz NOT NULL DEFAULT now(),
  stale_after         timestamptz,            -- TTL; re-run when now() > stale_after
  UNIQUE (parcel_id, kind)
);

CREATE INDEX research_cache_stale_idx ON research_cache (stale_after);
CREATE INDEX research_cache_needs_human_idx ON research_cache (needs_human) WHERE needs_human;

-- ---------------------------------------------------------------------------
-- comps — comparable sales snapshot used for a CMA
-- ---------------------------------------------------------------------------
CREATE TABLE comps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id        uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  comp_listing_key text NOT NULL,
  address          text,
  sold_price       numeric,
  sqft             integer,
  ppsf             numeric,
  sold_date        date,
  distance_mi      numeric,
  raw              jsonb,
  captured_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX comps_parcel_idx ON comps (parcel_id);

-- ---------------------------------------------------------------------------
-- pro_formas — one auto-generated default + user-edited scenarios
-- ---------------------------------------------------------------------------
CREATE TABLE pro_formas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id   uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  scenario    text NOT NULL,                  -- 'auto' | 'user:<sub>:<name>'
  inputs      jsonb NOT NULL,                 -- land, hard_cost_psf, site, soft, carry, sell_pct, target_sqft, ...
  arv_low     numeric,
  arv_high    numeric,
  allin_low   numeric,
  allin_high  numeric,
  profit_low  numeric,
  profit_high numeric,
  created_by  text,                           -- cognito sub
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parcel_id, scenario)
);

CREATE INDEX pro_formas_parcel_idx ON pro_formas (parcel_id);

-- ---------------------------------------------------------------------------
-- scores — daily ranking snapshot
-- ---------------------------------------------------------------------------
CREATE TABLE scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id   uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  run_date    date NOT NULL,
  score       numeric NOT NULL,               -- 0-100 composite
  rank        integer,
  profit_mid  numeric,
  flags       jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{code, detail}]
  summary     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parcel_id, run_date)
);

CREATE INDEX scores_run_rank_idx ON scores (run_date, rank);

-- ---------------------------------------------------------------------------
-- sync_state — incremental ModificationTimestamp watermark per provider
-- ---------------------------------------------------------------------------
CREATE TABLE sync_state (
  provider              text PRIMARY KEY,     -- 'repliers'
  last_modification_ts  timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- app_users — mirror of Cognito identity + watchlist join target
-- ---------------------------------------------------------------------------
CREATE TABLE app_users (
  cognito_sub  text PRIMARY KEY,
  email        text,
  display_name text,
  is_admin     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE watchlist (
  cognito_sub text NOT NULL REFERENCES app_users(cognito_sub) ON DELETE CASCADE,
  parcel_id   uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cognito_sub, parcel_id)
);

-- ---------------------------------------------------------------------------
-- audit_log — every mutating action (compliance requirement)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text,                            -- cognito sub
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  meta       jsonb,
  ts         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_ts_idx ON audit_log (ts);
CREATE INDEX audit_log_user_idx ON audit_log (user_id);
