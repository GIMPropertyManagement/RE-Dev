import type { MemoData } from './memo.js';

/** The shape GET /parcels/:id returns (permissive — both api and web map from it). */
export interface ParcelDetail {
  parcel: {
    id?: string;
    loc_id?: string | null;
    address?: string | null;
    city?: string | null;
  } | null;
  listings?: { list_price?: number | null; standard_status?: string | null }[];
  research?: {
    kind: string;
    payload: unknown;
    sources?: { title?: string; url?: string }[];
    confidence?: string;
    needs_human?: boolean;
  }[];
  proFormas?: {
    scenario: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputs?: any;
    arv_low?: number | null;
    arv_high?: number | null;
    allin_low?: number | null;
    allin_high?: number | null;
    profit_low?: number | null;
    profit_high?: number | null;
  }[];
  score?: {
    score?: number | null;
    profit_mid?: number | null;
    flags?: { code: string; detail?: string }[];
    summary?: string | null;
  } | null;
}

/** Map the API detail JSON into the memo's vendor-agnostic input. */
export function detailToMemoData(detail: ParcelDetail, generatedDate: string): MemoData {
  const p = detail.parcel ?? {};
  const latestListing = detail.listings?.[0];
  const auto = detail.proFormas?.find((pf) => pf.scenario === 'auto');
  const research = detail.research ?? [];
  const by = (kind: string) => research.find((r) => r.kind === kind)?.payload as Record<string, unknown> | undefined;

  const zoning = by('zoning');
  const flood = by('flood');
  const wetlands = by('wetlands');
  const topo = by('topo');
  const ownership = by('ownership');
  const cma = by('cma');

  const cap = (auto?.inputs?.all_in_cash_cap as number | undefined) ?? 700_000;

  return {
    generatedDate,
    address: p.address || '(address unknown)',
    town: p.city ?? null,
    locId: p.loc_id ?? null,
    score: detail.score?.score ?? null,
    recommendedOffer: (auto?.inputs?.land as number | undefined) ?? null,
    recommendedProduct:
      (auto?.inputs?.recommended_product as string | undefined) ??
      (cma?.recommended_product as string | undefined) ??
      null,
    listPrice: latestListing?.list_price ?? null,
    status: latestListing?.standard_status ?? null,
    summary: detail.score?.summary ?? null,
    proForma: auto
      ? {
          arvLow: auto.arv_low ?? null,
          arvHigh: auto.arv_high ?? null,
          allinLow: auto.allin_low ?? null,
          allinHigh: auto.allin_high ?? null,
          profitLow: auto.profit_low ?? null,
          profitHigh: auto.profit_high ?? null,
          profitMid: detail.score?.profit_mid ?? null,
          peakCash: auto.allin_high ?? null,
          fitsCap: auto.allin_high != null ? auto.allin_high <= cap : null,
        }
      : null,
    zoning: zoning
      ? {
          district: (zoning.district as string) ?? null,
          minLotSqft: (zoning.min_lot_sqft as number) ?? null,
          minFrontageFt: (zoning.min_frontage_ft as number) ?? null,
          varianceNeeded: (zoning.variance_needed as string[]) ?? [],
          aduAllowed: (zoning.adu_allowed as boolean) ?? null,
        }
      : null,
    flood: flood
      ? {
          floodZone: (flood.flood_zone as string) ?? null,
          inSfha: (flood.in_sfha as boolean) ?? null,
          mapped: Boolean(flood.mapped),
        }
      : null,
    wetlands: wetlands
      ? { intersects: Boolean(wetlands.intersects), types: (wetlands.types as string[]) ?? [] }
      : null,
    topo: topo
      ? {
          reliefM: (topo.relief_m as number) ?? null,
          slopePctEst: (topo.slope_pct_est as number) ?? null,
          walkout: (topo.walkout_potential as boolean) ?? null,
        }
      : null,
    ownership: ownership
      ? {
          owner: (ownership.owner as string) ?? null,
          lastSaleDate: (ownership.last_sale_date as string) ?? null,
          lastSalePrice: (ownership.last_sale_price as number) ?? null,
          assessedTotal: (ownership.assessed_total as number) ?? null,
          fy: (ownership.fy as number) ?? null,
        }
      : null,
    comps: (((cma?.comps as Record<string, unknown>[]) ?? []) as Record<string, unknown>[]).map((c) => ({
      address: (c.address as string) ?? null,
      soldPrice: (c.sold_price as number) ?? null,
      sqft: (c.sqft as number) ?? null,
      ppsf: (c.ppsf as number) ?? null,
      soldDate: (c.sold_date as string) ?? null,
      distanceMi: (c.distance_mi as number) ?? null,
    })),
    flags: detail.score?.flags ?? [],
    sources: research
      .flatMap((r) => r.sources ?? [])
      .filter((s): s is { title: string; url: string } => !!s.title && !!s.url),
  };
}
