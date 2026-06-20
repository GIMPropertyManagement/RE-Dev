import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchParcelDetail,
  reresearch,
  requestReport,
  toggleWatch,
  type DetailData,
} from '../lib/api';
import { money, num, scoreClass } from '../lib/format';
import { ParcelMap } from '../components/ParcelMap';
import { ProFormaEditor } from '../components/ProFormaEditor';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function Detail() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    let active = true;
    fetchParcelDetail(id)
      .then((d) => active && setDetail(d))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [id]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!detail) return <div className="empty">Loading…</div>;

  const p = detail.parcel;
  const kind = (k: string) => detail.research?.find((r) => r.kind === k);
  const zoning = kind('zoning')?.payload as any;
  const flood = kind('flood')?.payload as any;
  const wetlands = kind('wetlands')?.payload as any;
  const topo = kind('topo')?.payload as any;
  const ownership = kind('ownership')?.payload as any;
  const cma = kind('cma')?.payload as any;
  const auto = detail.proFormas?.find((pf) => pf.scenario === 'auto');
  const score = detail.score;

  async function action(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <Link to="/" className="back">← all parcels</Link>
          <h1>{p?.address ?? '(no address)'}</h1>
          <div className="dim">
            {p?.city ?? ''} {p?.loc_id ? `· Parcel ${p.loc_id}` : ''}
          </div>
        </div>
        <div className="detail-actions">
          {score?.score != null && <span className={`score big ${scoreClass(score.score)}`}>{score.score}</span>}
          <button className="btn-ghost" disabled={!!busy} onClick={() => action('watch', async () => setWatched((await toggleWatch(id)).watched))}>
            {watched ? '★ Watching' : '☆ Watch'}
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={() => action('reresearch', () => reresearch(id))}>
            {busy === 'reresearch' ? 'Busting…' : 'Re-research'}
          </button>
          <button className="btn" disabled={!!busy} onClick={() => action('pdf', () => requestReport(id))}>
            {busy === 'pdf' ? 'Generating…' : 'Export PDF memo'}
          </button>
        </div>
      </div>

      {score?.summary && <p className="summary">{score.summary}</p>}

      {score?.flags && score.flags.length > 0 && (
        <div className="flags detail-flags">
          {score.flags.map((f) => (
            <span key={f.code} className="chip" title={f.detail ?? f.code}>{f.code}</span>
          ))}
        </div>
      )}

      <div className="detail-grid">
        <section className="card">
          <h3>Location</h3>
          <ParcelMap lat={p?.lat} lng={p?.lng} lotGeojson={p?.lot_geojson} />
        </section>

        <section className="card">
          <h3>Pro Forma {auto && <span className="dim">(auto)</span>}</h3>
          {auto ? (
            <ProFormaEditor
              parcelId={id}
              initialInputs={auto.inputs}
              initialLand={(auto.inputs?.land as number) ?? null}
              arvLow={auto.arv_low ?? cma?.arv_low ?? null}
              arvHigh={auto.arv_high ?? cma?.arv_high ?? null}
            />
          ) : (
            <p className="dim">Not yet computed.</p>
          )}
        </section>

        <section className="card">
          <h3>Zoning & Buildability</h3>
          {zoning ? (
            <dl className="kv">
              <Row k="District" v={zoning.district} />
              <Row k="Min lot / frontage" v={`${num(zoning.min_lot_sqft)} sf · ${num(zoning.min_frontage_ft)} ft`} />
              <Row k="ADU by-right" v={zoning.adu_allowed == null ? '—' : zoning.adu_allowed ? 'yes' : 'no'} />
              {zoning.variance_needed?.length > 0 && <Row k="Variance" v={zoning.variance_needed.join('; ')} warn />}
            </dl>
          ) : <p className="dim">Needs review.</p>}
        </section>

        <section className="card">
          <h3>Site & Environmental</h3>
          <dl className="kv">
            {flood && <Row k="FEMA flood" v={flood.mapped ? `${flood.flood_zone ?? '?'}${flood.in_sfha ? ' (SFHA)' : ''}` : 'unmapped — verify'} warn={!!flood.in_sfha} />}
            {wetlands && <Row k="Wetlands (screen)" v={wetlands.intersects ? `${(wetlands.types || []).join(', ') || 'intersect'} — delineation needed` : 'none at point'} warn={!!wetlands.intersects} />}
            {topo && <Row k="Topo" v={`relief ${num(topo.relief_m)} m · ~${num(topo.slope_pct_est)}% · walkout ${topo.walkout_potential ? 'likely' : 'unlikely'}`} />}
          </dl>
        </section>

        <section className="card">
          <h3>Ownership & History</h3>
          {ownership ? (
            <dl className="kv">
              <Row k="Owner" v={ownership.owner} />
              <Row k="Last sale" v={`${ownership.last_sale_date ?? '—'} ${ownership.last_sale_price != null ? money(ownership.last_sale_price) : ''}`} />
              <Row k="Assessed" v={`${money(ownership.assessed_total)}${ownership.fy ? ` (FY${ownership.fy})` : ''}`} />
              <Row k="Held" v={ownership.hold_years != null ? `${ownership.hold_years} yrs` : '—'} />
            </dl>
          ) : <p className="dim">Unavailable.</p>}
        </section>

        <section className="card card-wide">
          <h3>Comparable Sales {cma?.comps && <span className="dim">({cma.comps.length})</span>}</h3>
          {cma?.comps?.length ? (
            <table className="grid compact">
              <thead><tr><th>Address</th><th className="num">Sold</th><th className="num">SqFt</th><th className="num">$/SF</th><th>Date</th><th className="num">Mi</th></tr></thead>
              <tbody>
                {cma.comps.map((c: any, i: number) => (
                  <tr key={i}>
                    <td>{c.address ?? '—'}</td>
                    <td className="num">{money(c.sold_price)}</td>
                    <td className="num">{num(c.sqft)}</td>
                    <td className="num">{c.ppsf != null ? `$${Math.round(c.ppsf)}` : '—'}</td>
                    <td>{c.sold_date ?? '—'}</td>
                    <td className="num">{c.distance_mi ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="dim">No comps.</p>}
          {cma?.avm_cross_check?.value != null && (
            <p className="dim">AVM cross-check: {money(cma.avm_cross_check.value)} ({cma.avm_cross_check.divergence_pct}% vs ARV)</p>
          )}
        </section>

        <section className="card card-wide">
          <h3>Sources</h3>
          <ul className="sources">
            {(detail.research ?? []).flatMap((r) => (r.sources ?? []).map((s, i) => (
              <li key={`${r.kind}-${i}`}>
                <span className="src-kind">{r.kind}</span>
                <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
              </li>
            )))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: unknown; warn?: boolean }) {
  return (
    <div className="kvrow">
      <dt>{k}</dt>
      <dd className={warn ? 'warn' : ''}>{v == null || v === '' ? '—' : String(v)}</dd>
    </div>
  );
}
