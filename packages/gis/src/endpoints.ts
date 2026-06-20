/**
 * Verified (live-queried 2026-06) ArcGIS REST endpoints for MA government GIS.
 *
 * All four return JSON directly — no scraping, no browser. The pipeline runs
 * headless and hits these with f=json.
 *
 * ⚠️ These URLs DRIFT (MassGIS re-publishes services; at least one widely-cited
 * parcel URL already 404s). Treat this as the seed registry, resolve/verify at
 * startup against the MassGIS Data Hub + the /rest/services directory, and add a
 * schema/health check that alerts when a layer's URL or field list changes.
 */
export const ENDPOINTS = {
  /** FEMA National Flood Hazard Layer. Layer 28 = Flood Hazard Zones. National, single base. */
  femaNfhl: {
    base: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer',
    floodHazardZonesLayer: 28,
  },
  /** MassGIS Level 3 standardized assessor parcels. Layer 0 = parcel polygons + assessor table. */
  massgisL3Parcels: {
    base: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/L3Parcels_feature_service/MapServer',
    layer: 0,
  },
  /** MassDEP Wetlands (hosted FeatureServer). 2005 vintage — SCREENING only, never authoritative for setbacks. */
  massDepWetlands: {
    base: 'https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/DEP_Wetlands/FeatureServer',
    layer: 0,
  },
  /** MassGIS 1m LiDAR DEM (ImageServer). Native Web Mercator (3857) — pass geometry with explicit spatialReference. */
  massgisElevation: {
    base: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/LiDAR/Elevation_LiDAR_INT/ImageServer',
  },
} as const;

/** US Census batch/one-line geocoder — free, no key. Fallback when a listing lacks lat/lng. */
export const CENSUS_GEOCODER =
  'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
