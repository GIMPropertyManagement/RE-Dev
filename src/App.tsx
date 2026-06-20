import { useEffect, useState } from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import { amplifyConfigured } from './amplifyConfig';
import {
  fetchParcels,
  previewMode,
  type ParcelFilters,
  type ParcelRow,
} from './lib/api';
import './App.css';

const PROPERTY_TYPES = [
  'Land',
  'Residential',
  'ResidentialIncome',
  'CommercialSale',
  'Farm',
];

function Dashboard({ signOut, email }: { signOut?: () => void; email?: string }) {
  const [filters, setFilters] = useState<ParcelFilters>({});
  const [draft, setDraft] = useState<ParcelFilters>({});
  const [rows, setRows] = useState<ParcelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchParcels(filters)
      .then((r) => {
        if (active) {
          setRows(r);
          setError(null);
        }
      })
      .catch((e) => active && setError(String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [filters]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Forge Hill <span className="brand-sub">Land Analyzer</span>
        </div>
        <div className="topbar-right">
          {previewMode && <span className="pill pill-warn">preview · sample data</span>}
          {email && <span className="user">{email}</span>}
          {signOut && (
            <button className="btn-ghost" onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </header>

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
        <input
          type="number"
          placeholder="Min $"
          onChange={(e) => setDraft({ ...draft, minPrice: numOrUndef(e.target.value) })}
        />
        <input
          type="number"
          placeholder="Max $"
          onChange={(e) => setDraft({ ...draft, maxPrice: numOrUndef(e.target.value) })}
        />
        <input
          type="number"
          placeholder="Min score"
          onChange={(e) => setDraft({ ...draft, minScore: numOrUndef(e.target.value) })}
        />
        <button className="btn" onClick={() => setFilters({ ...draft })}>
          Apply
        </button>
        <button
          className="btn-ghost"
          onClick={() => {
            setDraft({});
            setFilters({});
          }}
        >
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
              <tr>
                <td colSpan={11} className="empty">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="empty">
                  No parcels match these filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.mls_listing_key} className={r.resolution === 'unresolved' ? 'unresolved' : ''}>
                  <td className="num dim">{r.rank ?? '—'}</td>
                  <td>
                    <span className={`score ${scoreClass(r.score)}`}>{r.score ?? '—'}</span>
                  </td>
                  <td className="addr">{r.address ?? '(no address)'}</td>
                  <td>{r.city ?? '—'}</td>
                  <td>{r.property_type ?? '—'}</td>
                  <td>
                    <span className="status">{r.standard_status}</span>
                  </td>
                  <td className="num">{money(r.list_price)}</td>
                  <td className="num">{r.lot_acres ?? '—'}</td>
                  <td className="num profit">{money(r.profit_mid)}</td>
                  <td className="flags">
                    {r.flags.map((f) => (
                      <span key={f.code} className="chip" title={f.detail ?? f.code}>
                        {f.code}
                      </span>
                    ))}
                  </td>
                  <td className="dim">{r.modification_ts.slice(0, 10)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function App() {
  // No backend provisioned yet -> preview mode, no auth wall.
  if (!amplifyConfigured) return <Dashboard />;
  return (
    <Authenticator hideSignUp>
      {({ signOut, user }) => (
        <Dashboard
          signOut={signOut}
          email={(user as { signInDetails?: { loginId?: string } })?.signInDetails?.loginId}
        />
      )}
    </Authenticator>
  );
}

function numOrUndef(v: string): number | undefined {
  if (v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function money(v: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function scoreClass(score: number | null): string {
  if (score == null) return 'score-none';
  if (score >= 75) return 'score-hi';
  if (score >= 50) return 'score-mid';
  return 'score-lo';
}
