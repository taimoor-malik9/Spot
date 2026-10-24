const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 1440;

function trim(n, d = 1) {
  const f = Math.pow(10, d);
  const v = Math.round(n * f) / f;
  return Number.isInteger(v) ? String(v) : v.toFixed(d);
}

export function formatDuration(minutes) {
  const m = Number(minutes);
  if (!isFinite(m) || m <= 0) return '0 minutes';
  if (m >= MIN_PER_DAY) {
    const d = m / MIN_PER_DAY;
    return `${trim(d)} ${Math.round(d * 10) / 10 === 1 ? 'day' : 'days'}`;
  }
  if (m >= MIN_PER_HOUR) {
    const h = m / MIN_PER_HOUR;
    return `${trim(h)} ${Math.round(h * 10) / 10 === 1 ? 'hour' : 'hours'}`;
  }
  return `${trim(m, m < 10 ? 1 : 0)} ${Number(trim(m, m < 10 ? 1 : 0)) === 1 ? 'minute' : 'minutes'}`;
}

export function perHour(ratePerMinute) {
  const r = Number(ratePerMinute);
  return isFinite(r) ? Math.round(r * 60 * 100) / 100 : 0;
}

export function busyStatus(utilizationPct) {
  const u = Number(utilizationPct) || 0;
  if (u >= 95) return { key: 'overloaded', label: 'Never gets a break, work keeps piling up' };
  if (u >= 80) return { key: 'very_busy', label: 'Very busy' };
  if (u >= 40) return { key: 'balanced', label: 'Reasonably busy' };
  return { key: 'underused', label: 'Mostly sitting free' };
}

export function busySentence(utilizationPct) {
  const busy = Math.max(0, Math.min(100, Math.round(Number(utilizationPct) || 0)));
  return `Working ${busy}% of the time, free ${100 - busy}% of the time`;
}