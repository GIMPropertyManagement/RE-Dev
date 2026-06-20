import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchParcels, type ParcelFilters, type ParcelRow } from '../lib/api';
import { money, scoreClass } from '../lib/format';

const PROPERTY_TYPES = ['Land', 'Residential', 'ResidentialIncome', 'CommercialSale', 'Farm'];

export default function Dashboard() {
  const [filters, setFilters] = useState<ParcelFilters>({});
  const [draft, setDraft] = useState<ParcelFilters>({});
  const [rows, setRows] = useState<ParcelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchParcels(filters)
      .then((r) => active && (setRows(r), setError(null)))
      .catch((e) => active && setError(String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [filters]);

  return (
    <>
      <div className="filterbar">
        <input
          placeholder="Town"
          value={draft.city ?? ''}
          onChange={(e) => setDraft({ ...draft, city: e.target.value })}
        />
        <select
          value={draft.propertyType ?? ''}
          onChange={(e) => setDraft({ ...draft, propertyType: e.target.value || undefined })}
        >
          <option value="">All types</option>
          {PROPERTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input type="number" placeholder="Min $" onChange={(e) => setDraft({ ...draft, minPrice: numOrUndef(e.target.value) })} />
        <input type="number" placeholder="Max $" onChange={(e) => setDraft({ ...draft, maxPrice: numOrUndef(e.target.value) })} />
        <input type="number" placeholder="Min score" onChange={(e) => setDraft({ ...draft, minScore: numOrUndef(e.target.value) })} />
        <button className="btn" onClick={() => setFilters({ ...draft })}>
          Apply
        </button>
        <button className="btn-ghost" onClick={() => { setDraft({}); setFilters({}); }}>
          Reset
        </button>
        <span className="count">{rows.length} parcels</span>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr>
              <th>#</th>
              <th>Score</th>
              <th>Address</th>
              <th>Town</th>
              <th>Type</th>
              <th>Status</th>
              <th className="num">List</th>
              <th className="num">Lot ac</th>
              <th className="num">Profit (mid)</th>
              <th>Flags</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="empty">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={11} className="empty">No parcels match these filters.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.mls_listing_key} className={r.resolution === 'unresolved' ? 'unresolved' : ''}>
                  <td className="num dim">{r.rank ?? '—'}</td>
                  <td><span className={`score ${scoreClass(r.score)}`}>{r.score ?? '—'}</span></td>
                  <td className="addr">
                    {r.parcel_id ? (
                      <Link to={`/parcels/${r.parcel_id}`}>{r.address ?? '(no address)'}</Link>
                    ) : (
                      r.address ?? '(no address)'
                    )}
                  </td>
                  <td>{r.city ?? '—'}</td>
                  <td>{r.property_type ?? '—'}</td>
                  <td><span className="status">{r.standard_status}</span></td>
                  <td className="num">{money(r.list_price)}</td>
                  <td className="num">{r.lot_acres ?? '—'}</td>
                  <td className="num profit">{money(r.profit_mid)}</td>
                  <td className="flags">
                    {r.flags.map((f) => (
                      <span key={f.code} className="chip" title={f.detail ?? f.code}>{f.code}</span>
                    ))}
                  </td>
                  <td className="dim">{r.modification_ts.slice(0, 10)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function numOrUndef(v: string): number | undefined {
  if (v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
