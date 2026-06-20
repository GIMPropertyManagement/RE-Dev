import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** Vendor-agnostic input for the memo (api/web map their detail into this). */
export interface MemoData {
  generatedDate: string;
  address: string;
  town: string | null;
  locId: string | null;
  score: number | null;
  recommendedOffer: number | null;
  recommendedProduct: string | null;
  listPrice: number | null;
  status: string | null;
  summary: string | null;
  proForma: {
    arvLow: number | null;
    arvHigh: number | null;
    allinLow: number | null;
    allinHigh: number | null;
    profitLow: number | null;
    profitHigh: number | null;
    profitMid: number | null;
    peakCash: number | null;
    fitsCap: boolean | null;
  } | null;
  zoning: {
    district: string | null;
    minLotSqft: number | null;
    minFrontageFt: number | null;
    varianceNeeded: string[];
    aduAllowed: boolean | null;
  } | null;
  flood: { floodZone: string | null; inSfha: boolean | null; mapped: boolean } | null;
  wetlands: { intersects: boolean; types: string[] } | null;
  topo: { reliefM: number | null; slopePctEst: number | null; walkout: boolean | null } | null;
  ownership: {
    owner: string | null;
    lastSaleDate: string | null;
    lastSalePrice: number | null;
    assessedTotal: number | null;
    fy: number | null;
  } | null;
  comps: {
    address: string | null;
    soldPrice: number | null;
    sqft: number | null;
    ppsf: number | null;
    soldDate: string | null;
    distanceMi: number | null;
  }[];
  flags: { code: string; detail?: string }[];
  sources: { title: string; url: string }[];
  diligence?: string[];
}

const DEFAULT_DILIGENCE = [
  'Confirm zoning district & dimensional standards with the building department',
  'Order a site survey; verify frontage and setbacks',
  'Wetlands delineation by a certified wetland scientist (if flagged)',
  'Perc / soil test for septic feasibility',
  'Confirm utility availability & connection fees',
  'Title search for easements / restrictions (Registry of Deeds)',
  'Verify FEMA flood determination at the building envelope',
];

const PAGE = { w: 612, h: 792 };
const MARGIN = 50;
const INK = rgb(0.1, 0.12, 0.14);
const DIM = rgb(0.42, 0.46, 0.5);
const LINE = rgb(0.86, 0.88, 0.9);
const ACCENT = rgb(0.12, 0.43, 0.92);

/** Build a ~2-page investment memo. Returns raw PDF bytes (browser + Lambda). */
export async function buildMemoPdf(data: MemoData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ctx: Ctx = {
    doc,
    font,
    bold,
    page: doc.addPage([PAGE.w, PAGE.h]),
    y: PAGE.h - MARGIN,
  };

  // ---- Header
  text(ctx, 'FORGE HILL — INVESTMENT MEMO', bold, 16, INK);
  ctx.y -= 4;
  text(ctx, data.address, bold, 13, INK);
  text(
    ctx,
    `${data.town ?? ''}${data.locId ? `  ·  Parcel ${data.locId}` : ''}  ·  ${data.generatedDate}`,
    font,
    9,
    DIM,
  );
  ctx.y -= 6;
  rule(ctx);

  // ---- Exec summary + offer
  heading(ctx, 'Executive Summary');
  const headline = [
    data.score != null ? `Score ${data.score}/100` : null,
    data.recommendedOffer != null ? `Recommended offer ${money(data.recommendedOffer)}` : null,
    data.listPrice != null ? `(list ${money(data.listPrice)})` : null,
  ]
    .filter(Boolean)
    .join('   ');
  if (headline) text(ctx, headline, bold, 11, ACCENT);
  if (data.recommendedProduct) text(ctx, data.recommendedProduct, font, 10, INK);
  if (data.summary) paragraph(ctx, data.summary, 10);
  ctx.y -= 4;

  // ---- Snapshot / pro forma
  heading(ctx, 'Pro Forma');
  const pf = data.proForma;
  if (pf) {
    kv(ctx, 'ARV (low–high)', `${money(pf.arvLow)} – ${money(pf.arvHigh)}`);
    kv(ctx, 'All-in (low–high)', `${money(pf.allinLow)} – ${money(pf.allinHigh)}`);
    kv(ctx, 'Profit (low–high / mid)', `${money(pf.profitLow)} – ${money(pf.profitHigh)}  (mid ${money(pf.profitMid)})`);
    kv(ctx, 'Peak cash / fits cap?', `${money(pf.peakCash)}  ·  ${pf.fitsCap === false ? 'OVER CAP' : pf.fitsCap ? 'fits' : '?'}`);
  } else {
    text(ctx, 'Pro forma not yet computed.', font, 10, DIM);
  }
  ctx.y -= 4;

  // ---- Zoning & frontage
  heading(ctx, 'Zoning & Buildability');
  const z = data.zoning;
  if (z) {
    kv(ctx, 'District', z.district ?? '—');
    kv(ctx, 'Min lot / frontage', `${num(z.minLotSqft)} sf  ·  ${num(z.minFrontageFt)} ft`);
    kv(ctx, 'ADU by-right', z.aduAllowed == null ? '—' : z.aduAllowed ? 'yes' : 'no');
    if (z.varianceNeeded.length) kv(ctx, 'Variance needed', z.varianceNeeded.join('; '));
  } else {
    text(ctx, 'Zoning not verified — needs human review.', font, 10, DIM);
  }
  ctx.y -= 4;

  // ---- Site / environmental
  heading(ctx, 'Site & Environmental');
  if (data.flood) {
    kv(ctx, 'FEMA flood', data.flood.mapped ? `${data.flood.floodZone ?? '?'}${data.flood.inSfha ? ' (SFHA)' : ''}` : 'unmapped — verify');
  }
  if (data.wetlands) {
    kv(ctx, 'Wetlands (screen)', data.wetlands.intersects ? `intersect: ${data.wetlands.types.join(', ') || 'yes'} (delineation needed)` : 'none at point');
  }
  if (data.topo) {
    kv(ctx, 'Topo', `relief ${num(data.topo.reliefM)} m · ~${num(data.topo.slopePctEst)}% slope · walkout ${data.topo.walkout ? 'likely' : 'unlikely'}`);
  }
  ctx.y -= 4;

  // ---- Ownership
  heading(ctx, 'Ownership & History');
  const o = data.ownership;
  if (o) {
    kv(ctx, 'Owner', o.owner ?? '—');
    kv(ctx, 'Last sale', `${o.lastSaleDate ?? '—'}  ${o.lastSalePrice != null ? money(o.lastSalePrice) : ''}`);
    kv(ctx, 'Assessed', `${money(o.assessedTotal)}${o.fy ? ` (FY${o.fy})` : ''}`);
  } else {
    text(ctx, 'Ownership unavailable.', font, 10, DIM);
  }
  ctx.y -= 4;

  // ---- CMA
  heading(ctx, `Comparable Sales (${data.comps.length})`);
  compsTable(ctx, data.comps);
  ctx.y -= 4;

  // ---- Risk flags
  if (data.flags.length) {
    heading(ctx, 'Risk Flags');
    for (const f of data.flags) text(ctx, `• ${f.code}${f.detail ? ` — ${f.detail}` : ''}`, font, 9.5, INK);
    ctx.y -= 4;
  }

  // ---- Diligence checklist
  heading(ctx, 'Diligence Checklist');
  for (const item of data.diligence ?? DEFAULT_DILIGENCE) {
    text(ctx, `[ ]  ${item}`, font, 9.5, INK);
  }
  ctx.y -= 4;

  // ---- Sources
  if (data.sources.length) {
    heading(ctx, 'Sources');
    for (const s of data.sources) {
      paragraph(ctx, `• ${s.title} — ${s.url}`, 8, DIM);
    }
  }

  return doc.save();
}

// ---- drawing primitives ----------------------------------------------------

interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
}

function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < MARGIN) {
    ctx.page = ctx.doc.addPage([PAGE.w, PAGE.h]);
    ctx.y = PAGE.h - MARGIN;
  }
}

function text(ctx: Ctx, s: string, font: PDFFont, size: number, color = INK): void {
  ensure(ctx, size + 4);
  ctx.y -= size;
  ctx.page.drawText(s, { x: MARGIN, y: ctx.y, size, font, color });
  ctx.y -= 4;
}

function heading(ctx: Ctx, s: string): void {
  ctx.y -= 4;
  text(ctx, s.toUpperCase(), ctx.bold, 10.5, INK);
  ctx.y += 2;
  rule(ctx);
}

function rule(ctx: Ctx): void {
  ensure(ctx, 8);
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE.w - MARGIN, y: ctx.y },
    thickness: 0.5,
    color: LINE,
  });
  ctx.y -= 8;
}

function kv(ctx: Ctx, k: string, v: string): void {
  ensure(ctx, 14);
  ctx.y -= 11;
  ctx.page.drawText(k, { x: MARGIN, y: ctx.y, size: 9, font: ctx.bold, color: DIM });
  ctx.page.drawText(v, { x: MARGIN + 150, y: ctx.y, size: 9.5, font: ctx.font, color: INK });
  ctx.y -= 3;
}

function paragraph(ctx: Ctx, s: string, size: number, color = INK): void {
  const maxW = PAGE.w - MARGIN * 2;
  for (const line of wrap(s, ctx.font, size, maxW)) {
    text(ctx, line, ctx.font, size, color);
    ctx.y += 1;
  }
}

function compsTable(ctx: Ctx, comps: MemoData['comps']): void {
  if (!comps.length) {
    text(ctx, 'No comparable sales found.', ctx.font, 9.5, DIM);
    return;
  }
  const cols = [
    { h: 'Address', x: MARGIN, w: 200 },
    { h: 'Sold', x: MARGIN + 200, w: 80 },
    { h: 'SqFt', x: MARGIN + 280, w: 50 },
    { h: '$/SF', x: MARGIN + 330, w: 50 },
    { h: 'Date', x: MARGIN + 380, w: 70 },
    { h: 'Mi', x: MARGIN + 450, w: 40 },
  ];
  ensure(ctx, 14);
  ctx.y -= 11;
  for (const c of cols) ctx.page.drawText(c.h, { x: c.x, y: ctx.y, size: 8, font: ctx.bold, color: DIM });
  ctx.y -= 3;
  rule(ctx);
  for (const cm of comps.slice(0, 12)) {
    ensure(ctx, 13);
    ctx.y -= 10;
    const row = [
      clip(cm.address ?? '—', 34),
      money(cm.soldPrice),
      num(cm.sqft),
      cm.ppsf != null ? `$${Math.round(cm.ppsf)}` : '—',
      cm.soldDate ?? '—',
      cm.distanceMi != null ? String(cm.distanceMi) : '—',
    ];
    row.forEach((val, i) =>
      ctx.page.drawText(val, { x: cols[i].x, y: ctx.y, size: 8.5, font: ctx.font, color: INK }),
    );
    ctx.y -= 2;
  }
}

function wrap(s: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function money(n: number | null | undefined): string {
  return n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;
}
function num(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('en-US');
}
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
