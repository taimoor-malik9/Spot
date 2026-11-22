// Plain-language helpers for the "Solve a problem" option cards.

export const VERDICT_TONES = {
  good: { bg: '#dcfce7', fg: '#166534' },
  warn: { bg: '#fef3c7', fg: '#92400e' },
  bad: { bg: '#fee2e2', fg: '#b91c1c' },
  flat: { bg: '#f1f5f9', fg: '#475569' },
};

export function fmtMin(value) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return '—';
  if (n >= 60) {
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} min`;
}

export function fmtRs(value) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return '—';
  return `Rs ${n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) < 100 ? 1 : 0 })}`;
}

export function pctChange(from, to) {
  if (from == null || to == null) return null;
  const a = Number(from);
  const b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b - a) / a) * 100;
}

/**
 * One plain sentence for an option card.
 * `row.change` is the % change in the user's goal metric (negative is good, except throughput).
 * A change counts only at >= 5%, the same rule used everywhere else in SPOT.
 */
export function buildVerdict({ row, goalMetric, cpcPct, cpcAbs }) {
  if (row.baseline) return { text: 'Where you are today', tone: 'flat' };
  const change = row.change;
  const goalGood = change != null && (goalMetric === 'throughput' ? change >= 5 : change <= -5);
  const goalBad = change != null && (goalMetric === 'throughput' ? change <= -5 : change >= 5);
  const costUp = cpcPct != null && cpcPct >= 5;
  const costDown = cpcPct != null && cpcPct <= -5;

  if (goalBad) return { text: 'Worse than today', tone: 'bad' };
  if (goalGood && costUp) return { text: `Better, but costs ${fmtRs(cpcAbs)} more per customer`, tone: 'warn' };
  if (goalGood) return { text: costDown ? 'Better, and cheaper' : 'Better, similar cost', tone: 'good' };
  if (costUp) return { text: 'Costs more, no real improvement', tone: 'bad' };
  return { text: 'No real change', tone: 'flat' };
}