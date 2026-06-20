import { useMemo, useState } from 'react';
import { computeProForma } from '@forge/scoring/proforma';
import { DEFAULT_PRO_FORMA_INPUTS, type ProFormaInputs } from '@forge/scoring/config';
import { money } from '../lib/format';
import { saveScenario } from '../lib/api';

interface Field {
  key: keyof ProFormaInputs;
  label: string;
}
const FIELDS: Field[] = [
  { key: 'target_sqft', label: 'Target SqFt' },
  { key: 'hard_cost_psf_low', label: 'Hard $/SF (low)' },
  { key: 'hard_cost_psf_high', label: 'Hard $/SF (high)' },
  { key: 'site_work_high', label: 'Site work (high)' },
  { key: 'soft_costs_high', label: 'Soft costs (high)' },
  { key: 'carry_high', label: 'Carry (high)' },
  { key: 'utility_connections', label: 'Utilities' },
  { key: 'all_in_cash_cap', label: 'Cash cap' },
];

export function ProFormaEditor({
  parcelId,
  initialInputs,
  initialLand,
  arvLow,
  arvHigh,
}: {
  parcelId: string;
  initialInputs?: Partial<ProFormaInputs>;
  initialLand: number | null;
  arvLow: number | null;
  arvHigh: number | null;
}) {
  const [inputs, setInputs] = useState<ProFormaInputs>({ ...DEFAULT_PRO_FORMA_INPUTS, ...initialInputs });
  const [land, setLand] = useState<number>(initialLand ?? 0);
  const [name, setName] = useState('my-scenario');
  const [saved, setSaved] = useState<string | null>(null);

  const pf = useMemo(() => computeProForma(land, arvLow, arvHigh, inputs), [land, arvLow, arvHigh, inputs]);

  async function save() {
    setSaved('saving…');
    try {
      const r = await saveScenario(parcelId, { name, land, inputs: numericInputs(inputs) });
      setSaved(`saved ${r.scenario}`);
    } catch (e) {
      setSaved(`error: ${String(e)}`);
    }
  }

  return (
    <div className="pfeditor">
      <div className="pfgrid">
        <label className="pffield">
          <span>Land / offer</span>
          <input type="number" value={land} onChange={(e) => setLand(Number(e.target.value))} />
        </label>
        {FIELDS.map((f) => (
          <label key={f.key} className="pffield">
            <span>{f.label}</span>
            <input
              type="number"
              value={inputs[f.key]}
              onChange={(e) => setInputs({ ...inputs, [f.key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>

      <div className="pfresult">
        <div><b>All-in</b> {money(pf.allin_low)} – {money(pf.allin_high)}</div>
        <div><b>Profit</b> {money(pf.profit_low)} – {money(pf.profit_high)} <span className="dim">(mid {money(pf.profit_mid)})</span></div>
        <div><b>Margin</b> {pf.margin_pct != null ? `${(pf.margin_pct * 100).toFixed(1)}%` : '—'}</div>
        <div className={pf.fits_cap ? 'ok' : 'bad'}>
          <b>Peak cash</b> {money(pf.peak_cash)} · {pf.fits_cap ? 'fits cap' : 'OVER CAP'}
        </div>
      </div>

      <div className="pfsave">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="scenario name" />
        <button className="btn" onClick={save}>Save scenario</button>
        {saved && <span className="dim">{saved}</span>}
      </div>
    </div>
  );
}

function numericInputs(inputs: ProFormaInputs): Record<string, number> {
  return Object.fromEntries(Object.entries(inputs).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
}
