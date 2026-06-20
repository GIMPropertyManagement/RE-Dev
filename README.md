# Forge Hill Land Analyzer

Internal-only web app that ingests every Massachusetts MLS PIN listing daily,
runs an automated research + pro forma pipeline per parcel (zoning, frontage,
topo/elevation, FEMA flood, wetlands, assessor/ownership, new-construction CMA),
caches the research per parcel so it never re-runs the same work, and ranks the
best build-and-sell opportunities. Automates the manual workflow behind 33 Russo
Drive.

**Internal back-office use only.** No public site, no IDX, no consumer access.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for decisions, the verified-fact
corrections to the original PRD, and the build plan.

## Layout (npm workspaces)

```
/src           React (Vite) dashboard — Amplify-hosted
/amplify       Amplify Gen 2 — Cognito auth ONLY
/packages
  shared       RESO-normalized types + MlsProvider interface
  providers    RepliersProvider (Phase-1 MLS feed) + tests
  gis          MassGIS L3 parcel resolution + FEMA/wetlands/elevation clients
  db           PostGIS schema/migrations + RDS Data API access layer
  pipeline     daily incremental ingest Lambda
  api          Cognito-authed app API Lambda
  research     per-parcel research engine (GIS kinds + zoning LLM) with TTL caching
  scoring      pro forma + 0-100 score + risk flags + recommended offer
  infra        CDK app (Aurora Serverless v2, Lambdas, EventBridge, S3, secrets)
```

## Getting started

```bash
npm install

# Run the dashboard in PREVIEW mode (sample data, no backend, no auth wall):
npm run dev            # http://localhost:5173

npm test               # provider normalization + incremental-sync tests
npm run typecheck      # all packages
npm run build          # web app production build
```

The dashboard runs immediately in **preview mode** because there's no
`amplify_outputs.json` yet. Once a backend is provisioned it switches to real
Cognito auth + the live API automatically. Point the web app at the deployed API
with `VITE_API_URL` (see `.env.example`).

## Current status

**Phases 1–3 built** (34 tests green), building against Repliers **sandbox**
data. Phase 1 = ingest + store + dashboard; Phase 2 = the per-parcel research
engine (flood/wetlands/topo/ownership/CMA deterministic from government GIS +
our own comps; zoning via Claude with web tools + source validation; TTL
caching); Phase 3 = pro forma + 0–100 score + risk flags + recommended offer,
the enrich step wired into the daily pipeline (research → feasibility → rank),
and the watch/proforma/runs/digest API endpoints. Live MLS data is gated on the
MLS PIN broker agreement — see Phase 0 in [ARCHITECTURE.md](ARCHITECTURE.md).
Phases 4–5 (detail page + PDF memo export, polish) remain.

## Provisioning (later)

1. `npx ampx sandbox` (or deploy) — creates the Cognito pool + `amplify_outputs.json`.
2. `cd packages/infra && npm run deploy` — Aurora + Lambdas + API (pass the
   Cognito ids via `USER_POOL_ID` / `USER_POOL_CLIENT_ID`).
3. Apply `packages/db/migrations/*.sql` (PostGIS first).
4. Put the Repliers key in the `RepliersApiKey` secret.

## License

Private / internal.
