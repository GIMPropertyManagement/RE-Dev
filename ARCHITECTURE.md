# Forge Hill Land Analyzer — Architecture & Decisions

Internal-only tool that ingests every MA MLS PIN listing daily, analyzes each
parcel for build-and-sell feasibility, caches the research per parcel, and ranks
opportunities. This document records the **decisions and the verified facts they
rest on** (the PRD had several assumptions that turned out to be wrong; the
corrected positions are below).

## Status

**Phases 1–3 built, against Repliers sandbox data.** Phase 1: provider seam,
parcel resolution, DB schema, ingest pipeline, app API, CDK infra, authed
dashboard. Phase 2: the research engine (`@forge/research`) — six per-parcel
kinds with TTL caching and the never-invent contract. Phase 3: pro forma + 0–100
score + risk flags + recommended offer (`@forge/scoring`), the enrich step wired
into the daily pipeline (research → feasibility → persist → rank), and the
watch/proforma/runs/digest API endpoints. All typecheck/build/test green (34
tests). Nothing is deployed and no live MLS data flows yet — gated on the MLS PIN
broker agreement (Phase 0, below). Phases 4–5 (detail page + PDF memo, polish)
remain.

## Component map

```
GitHub ──CI/CD──▶ Amplify Hosting (React SPA, /src)  ── Cognito-authed ──▶ HTTP API (API Gateway + JWT authorizer)
                         │                                                        │
                  Cognito (Amplify-managed, /amplify)                       @forge/api Lambda  (OUTSIDE the VPC)
                                                                                  │  RDS Data API (HTTPS)
                                                                                  ▼
                                                          Aurora Serverless v2 (PostgreSQL + PostGIS, min ACU 0)
                                                                                  ▲  RDS Data API (HTTPS)
   EventBridge (daily cron) ──▶ @forge/pipeline ingest Lambda (OUTSIDE the VPC) ──┤
                                   │  Repliers /listings (REPLIERS-API-KEY)       │
                                   │  MassGIS L3 (parcel resolution)        S3 (raw payloads, PDFs, photos)
```

Code lives in npm workspaces:

| Package | Role |
|---|---|
| `@forge/shared` | RESO-normalized `MlsListing`, domain types, the `MlsProvider` interface |
| `@forge/providers` | `RepliersProvider` (+ normalization, tested) — the Phase-1 feed |
| `@forge/gis` | MassGIS L3 parcel resolver + FEMA/wetlands/elevation clients |
| `@forge/db` | PostGIS schema/migrations + RDS Data API access layer |
| `@forge/pipeline` | daily incremental ingest (provider → resolve → upsert → watermark) |
| `@forge/api` | Cognito-authed app API Lambda |
| `@forge/research` | per-parcel research engine (4 deterministic GIS kinds + deterministic CMA + zoning LLM) with TTL caching |
| `@forge/scoring` | pro forma (Russo defaults), 0–100 score, risk flags, recommended offer, feasibility synthesis |
| `@forge/infra` | CDK app (Aurora, Lambdas, EventBridge, S3, secrets) |
| `/src` (root) | React (Vite) dashboard, Amplify-hosted |
| `/amplify` | Amplify Gen 2 — **Cognito auth only** (no data layer) |

## Key decisions (and the facts behind them)

### 1. Amplify for hosting + Cognito only; data lives in a separate CDK stack
The starter template's Amplify **`data`** layer (a `Todo` model on AppSync/
DynamoDB with a **public API key**) was deleted — it's the wrong data model and a
live security liability. The analyzer needs spatial parcel resolution and
relational queries, so the store is **Aurora Serverless v2 + PostGIS**, owned by
`@forge/infra` (CDK). The seam between the two is the Cognito **User Pool ID +
App Client ID** (passed into the API's JWT authorizer). IaC is **CDK** (not SST/
Amplify-custom-resources) — Amplify Gen 2 already wraps CDK, so CDK is the
lowest-friction superset for a VPC+Aurora+EventBridge stack.

### 2. RDS Data API, **not** RDS Proxy
RDS Proxy holds connections open, which **prevents Aurora Serverless v2 auto-pause
to 0 ACU** — defeating the scale-to-zero cost goal. The Data API is HTTP, needs
no pooling, and pairs with scale-to-zero. Set Aurora min ACU = 0 (PostgreSQL ≥
16.3). First request after idle resumes in ~15s, so app DB calls use >15s
timeouts + a loading state.

### 3. No NAT Gateway
VPC-attached Lambdas have **no internet by default**, and Anthropic/Repliers have
no PrivateLink — naively that forces a NAT (~$33–70/mo). Instead, **both Lambdas
run OUTSIDE the VPC**: they reach Repliers/MassGIS/Claude over the internet and
Aurora via the Data API (an HTTPS AWS endpoint). The VPC exists only to host the
private Aurora cluster. No NAT.

### 4. Provider = Repliers (resolves the PRD's self-contradiction)
The PRD said "Decision: Repliers" in one place and "SimplyRETS" in four others.
**Committed to Repliers** (`@forge/providers/RepliersProvider`): free sandbox key
in minutes, built-in sold comps + AVM. Verified API facts baked in:
- Server base `https://api.repliers.io`, header `REPLIERS-API-KEY` (server-side
  only; never the `csr-api.repliers.io` client base).
- `/listings` must be **POST** for image/bundled queries; GET is fine for the
  filtered incremental sync we do.
- AVM is **POST `/estimates`** (create-then-read), not a read-only lookup.
- 1M requests/mo is **per MLS board**; overage bills linearly with no hard stop —
  we cap page sizes and rely on the watermark to avoid full scans.

Everything normalizes to **RESO Data Dictionary** field names internally, anchored
to MLS PIN's served version (**DD 1.7**) with the mapping isolated in the adapter.
Swapping to SimplyRETS/Bridge/direct-RESO is a one-class change behind
`MlsProvider`.

### 5. Parcel resolution via MassGIS L3 (the PRD's deepest gap, fixed)
`unique(address, city, zip)` corrupts the "never re-research" cache — raw land
often has no street address ("Lot 4 Russo Dr") and addresses vary. Instead every
listing is **geocoded → point-in-polygon against MassGIS L3 parcels** and keyed
on the authoritative **`LOC_ID`**. Exactly-one-intersect ⇒ resolved; 0 or >1 ⇒
`unresolved`, held for human review (we never guess a parcel identity). This is
where PostGIS earns its place. Bonus: the L3 layer **carries the full assessor
table** (owner, values, use code, lot size, last sale, zoning) as JSON, so the
ownership/assessor research kind needs **no VGSI/Patriot scraping**.

### 6. Government GIS is headless JSON (verified, live-queried)
Four of five core sources are ArcGIS REST `f=json` — no scraping. Endpoints seeded
in `@forge/gis/endpoints.ts` (resolve/health-check at runtime; they drift):
FEMA NFHL (flood, layer 28), MassGIS L3 (parcels+assessor), MassDEP Wetlands
(2005 vintage — **screening only**), MassGIS LiDAR DEM (elevation; pass geometry
with an explicit spatialReference or it returns NoData). **Zoning is the
exception** — no statewide machine-readable source, so the research engine reads
each town's ordinance (highest `needs_human` rate).

### 7. Research engine (Phase 2 — BUILT: `@forge/research`)
**Key refinement from the verification: 5 of 6 kinds are deterministic — only
zoning needs the LLM.** This slashes cost and removes hallucination risk where it
matters most (the source IS the government endpoint).
- **Deterministic kinds (no LLM):** `flood` (FEMA NFHL), `wetlands` (MassDEP,
  screening-only → needs_human on a hit), `topo` (samples the LiDAR DEM across a
  ~30m envelope for relief/slope/walkout), `ownership` (MassGIS L3 assessor
  attributes — no scraping). Each carries the gov endpoint as its source URL.
- **CMA is also deterministic:** computed from **our own provider sold comps**
  (median $/SF → ARV for the default product), with the provider AVM as a flagged
  cross-check. No fabricated comps.
- **Zoning (the one LLM kind):** Claude reads the town's adopted bylaw via
  server-side `web_search_20260209` / `web_fetch_20260209`, returns structured
  JSON (`output_config.format` — **not** the Citations API, which is incompatible)
  with `sources[]` as schema fields, on `claude-opus-4-8` (variance risk is
  high-stakes). `pause_turn` is handled by re-sending `response.content` inside
  one call (`claude.ts`). Every cited URL is validated against a gov/ordinance
  **allowlist + "fetched this turn"** (`urlValidator.ts`); a result with no
  surviving source is downgraded to `needs_human`.
- **Caching:** `cache.ts` + `orchestrator.ts` honor per-kind TTLs (zoning/topo/
  flood/wetlands/ownership = 180d, CMA = 21d) and only bust price-sensitive kinds
  (CMA) on a material listing change — the "never re-research" core, keyed on the
  parcel.
- **Model routing & cost (for any future extraction-style kinds):**
  `claude-haiku-4-5` extraction / `claude-opus-4-8` synthesis; the cheap fan-out
  can run through the **Batches API (50%)**; prompt-cache the shared system+tools.
### 7a. Scoring & pro forma (Phase 3 — BUILT: `@forge/scoring`)
- **Pro forma** encodes the 33 Russo math with Russo-derived **defaults** (hard
  $150–185/sf, site $40–50k, soft $20–25k, carry $20–25k, sell 5%, $700k cash
  cap), all overridable per scenario. `profit_low` pairs conservative ARV with
  high cost; `peak_cash`/`fits_cap` surface the cash ceiling; a smaller-SF variant
  is suggested when over cap.
- **Recommended offer** = the lower of a DOM/price-cut-driven discount off list
  (Russo: long DOM + two cuts → well under ask) and the max land that still clears
  a 20% target margin.
- **Score (0–100)** = weighted blend of profit / margin / risk-flag penalties /
  data confidence / liquidity (comp depth); weights in config.
- **Flags** derive from the research bag (flood SFHA, wetlands hit, steep slope,
  zoning variance, thin comps, over-cap, low confidence).
- **Wired into the pipeline:** `@forge/pipeline` `runDailyEnrich` selects parcels
  not yet scored today → research → `synthesizeFeasibility` → persist the `auto`
  pro forma + the day's `scores` row → `rankRun`. A second EventBridge Lambda
  (`EnrichFn`, 07:30 UTC) runs it after ingest.

### 8. Step Functions deferred
For 3 users and a once-daily bounded batch, a single scheduled ingest Lambda
covers it. Step Functions (visual partial-failure isolation) can be added later
behind the same handler interface once per-parcel enrich is long/expensive.

### 9. Auth — 10-year session (chosen) with mandatory rails
Product decision: ~10-year "stay logged in" (Cognito refresh token = 3650 days;
access/ID tokens stay 60 min and silently refresh). Because the refresh token
never expires on its own, the following are **not optional** (configured in
`amplify/backend.ts` / `auth/resource.ts`):
- **Token revocation enabled** + an admin **Global Sign-Out** ("revoke all
  sessions") path — the only way to kill a stolen long session.
- **No public sign-up** (`allowAdminCreateUserOnly`); admin creates the 3 users.
- **MFA available** (TOTP, OPTIONAL) + Remember Devices — recommend each user
  enables it.
- **Known residual risk:** the token lives in the SPA's `localStorage` — an
  httpOnly cookie is **not achievable** in a client-side Vite app (httpOnly can't
  be set by JS; Amplify falls back to localStorage). One XSS = ~10-year exposure,
  and the data includes owner PII. **Mitigate with a strict CSP** and revisit if
  the app ever moves to SSR/BFF. (Recommended alternative on the table: 90–180-day
  rotating refresh token — declined for now.)

## Compliance notes
- **Internal back-office only** — no public display/redistribution. We honor
  `InternetEntireListingDisplayYN` conservatively even internally.
- **MLS PIN fee is the $100/mo broker rate**, not the $525/mo vendor rate (the
  vendor track even requires a public portal we don't want). Confirm in writing.
- **Retention is a contract question:** the modern path is on-demand RESO Web API,
  not bulk replication. Have the signed agreement's permitted-use/**retention**
  clauses reviewed **before** relying on the "cache everything in Aurora" design.
- `audit_log` records every mutating action; owner PII is restricted to the 3
  authed users.

## Known wiring TODOs (deploy-time)
1. **Lambda bundling:** handlers use NodeNext `.js` import specifiers; add a small
   esbuild alias or a `tsc` prebuild so `NodejsFunction` resolves them.
2. **`CONFIRM(sandbox)` in `repliers.ts`:** the exact incremental "updated since"
   param, the sold-comps radius unit, and the `/estimates` body — verify against a
   live sandbox key (normalization is already locked by tests).
3. **Seed the API authorizer** with the Amplify user-pool/client ids
   (`USER_POOL_ID` / `USER_POOL_CLIENT_ID`).
4. **Migrations runner:** apply `packages/db/migrations/*.sql` (PostGIS first) via
   the Data API or psql.

## Phase 0 (business, in parallel — gates live data)
1. Broker of record signs the **MLS PIN Broker Data Access Agreement** (the long
   pole). Confirm the **$100/mo broker rate** and that the "display URL" = our
   internal authed domain.
2. Create a **Repliers account → free sandbox key**; confirm live MA / MLS PIN
   coverage on the account.
3. Provision AWS, the Cognito pool (3 users), GitHub repo + Amplify Hosting.
