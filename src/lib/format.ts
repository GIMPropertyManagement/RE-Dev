export function money(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function num(v: number | null | undefined): string {
  return v == null ? '—' : v.toLocaleString('en-US');
}

export function scoreClass(score: number | null | undefined): string {
  if (score == null) return 'score-none';
  if (score >= 75) return 'score-hi';
  if (score >= 50) return 'score-mid';
  return 'score-lo';
}
