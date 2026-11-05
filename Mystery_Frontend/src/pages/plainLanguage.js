const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 1440;

function trim(n, d = 1) {
  const f = Math.pow(10, d);
  const v = Math.round(n * f) / f;
  return Number.isInteger(v) ? String(v) : v.toFixed(d);
}

/**
 * Localized duration formatter.
 * e.g. formatDuration(27, 'ur') -> "27 منٹ"
 *      formatDuration(27, 'ur-roman') -> "27 min"
 *      formatDuration(27, 'en') -> "27 minutes"
 */
export function formatDuration(minutes, lang = 'en') {
  const m = Number(minutes);
  if (!isFinite(m) || m <= 0) {
    if (lang === 'ur') return '0 منٹ';
    if (lang === 'ur-roman') return '0 min';
    return '0 minutes';
  }
  if (m >= MIN_PER_DAY) {
    const d = m / MIN_PER_DAY;
    const val = trim(d);
    if (lang === 'ur') return `${val} دن`;
    if (lang === 'ur-roman') return `${val} din`;
    return `${val} ${Math.round(d * 10) / 10 === 1 ? 'day' : 'days'}`;
  }
  if (m >= MIN_PER_HOUR) {
    const h = m / MIN_PER_HOUR;
    const val = trim(h);
    if (lang === 'ur') return `${val} گھنٹے`;
    if (lang === 'ur-roman') return `${val} ghante`;
    return `${val} ${Math.round(h * 10) / 10 === 1 ? 'hour' : 'hours'}`;
  }
  const val = trim(m, m < 10 ? 1 : 0);
  if (lang === 'ur') return `${val} منٹ`;
  if (lang === 'ur-roman') return `${val} min`;
  return `${val} ${Number(val) === 1 ? 'minute' : 'minutes'}`;
}

/**
 * Localized rate formatter.
 * e.g. formatRate(6.3, 'hr', 'ur') -> "6.3 فی گھنٹہ"
 *      formatRate(6.3, 'hr', 'ur-roman') -> "6.3 per ghanta"
 *      formatRate(6.3, 'hr', 'en') -> "6.3/hr"
 */
export function formatRate(n, unit = 'hr', lang = 'en') {
  const num = Number(n);
  const val = isFinite(num) ? (num % 1 === 0 ? String(num) : num.toFixed(1)) : '0';
  if (lang === 'ur') {
    if (unit === 'hr' || unit === 'hour') return `${val} فی گھنٹہ`;
    if (unit === 'day') return `${val} فی دن`;
    return `${val} فی ${unit}`;
  }
  if (lang === 'ur-roman') {
    if (unit === 'hr' || unit === 'hour') return `${val} per ghanta`;
    if (unit === 'day') return `${val} per din`;
    return `${val} per ${unit}`;
  }
  return `${val}/${unit}`;
}

/**
 * Localized currency formatter.
 * e.g. formatCurrency(500, 'ur') -> "500.00 روپے"
 *      formatCurrency(500, 'ur-roman') -> "Rs 500.00"
 *      formatCurrency(500, 'en') -> "Rs 500.00"
 */
export function formatCurrency(n, lang = 'en', currency = 'Rs') {
  const num = Number(n);
  const val = isFinite(num)
    ? num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
  if (lang === 'ur') {
    return `${val} روپے`;
  }
  if (lang === 'ur-roman') {
    return `Rs ${val}`;
  }
  return `${currency} ${val}`;
}

export function perHour(ratePerMinute) {
  const r = Number(ratePerMinute);
  return isFinite(r) ? Math.round(r * 60 * 100) / 100 : 0;
}

export function busyStatus(utilizationPct, lang = 'en') {
  const u = Number(utilizationPct) || 0;
  if (u >= 95) {
    return {
      key: 'overloaded',
      label:
        lang === 'ur'
          ? 'کبھی فرصت نہیں ملتی، کام جمع ہوتا رہتا ہے'
          : lang === 'ur-roman'
          ? 'Kabhi break nahi milta, kaam jama hota rehta hai'
          : 'Never gets a break, work keeps piling up',
    };
  }
  if (u >= 80) {
    return {
      key: 'very_busy',
      label: lang === 'ur' ? 'بہت مصروف' : lang === 'ur-roman' ? 'Bohat masroof' : 'Very busy',
    };
  }
  if (u >= 40) {
    return {
      key: 'balanced',
      label: lang === 'ur' ? 'مناسب حد تک مصروف' : lang === 'ur-roman' ? 'Munasib masroof' : 'Reasonably busy',
    };
  }
  return {
    key: 'underused',
    label: lang === 'ur' ? 'زیادہ تر فارغ بیٹھے ہیں' : lang === 'ur-roman' ? 'Zyada tar free bethe hain' : 'Mostly sitting free',
  };
}

export function busySentence(utilizationPct, lang = 'en') {
  const busy = Math.max(0, Math.min(100, Math.round(Number(utilizationPct) || 0)));
  const free = 100 - busy;
  if (lang === 'ur') {
    return `${busy}٪ وقت کام، ${free}٪ وقت فارغ`;
  }
  if (lang === 'ur-roman') {
    return `${busy}% waqt kaam, ${free}% waqt free`;
  }
  return `Working ${busy}% of the time, free ${free}% of the time`;
}
