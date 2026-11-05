/**
 * resultsHelper.js - Shared helper for Results and Scenarios views
 *
 * Normalizes simulation result metrics, bottlenecks, and scenario lists into
 * safe, plain display values so baseline and what-if comparison views cannot drift apart
 * or leak "[object Object]".
 */

/**
 * Extracts a safe string from any value (string, object with name/label/title, etc.)
 */
export function extractSafeString(val, fallback = '') {
  if (typeof val === 'string') {
    return val === '[object Object]' ? fallback : val;
  }
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : fallback;
  }
  if (val && typeof val === 'object') {
    const candidate = val.name ?? val.label ?? val.title ?? val.task_name ?? val.resource ?? val.task_id ?? val.id;
    if (typeof candidate === 'string') return candidate;
    if (typeof candidate === 'object' && candidate !== null) {
      return extractSafeString(candidate, fallback);
    }
  }
  return fallback;
}

/**
 * Extracts a safe number from any value (number, object with value/current/pct, etc.)
 */
export function extractSafeNumber(val, fallback = 0) {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : fallback;
  }
  if (typeof val === 'string') {
    const parsed = parseFloat(val);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (val && typeof val === 'object') {
    const candidate = val.current ?? val.value ?? val.pct ?? val.utilization_pct ?? val.max;
    return extractSafeNumber(candidate, fallback);
  }
  return fallback;
}

/**
 * Converts a simulation result into plain display values.
 * Used across both baseline results and scenario results (what-if comparison).
 */
export function getBottleneckView(result, idToLabel = {}) {
  if (!result || typeof result !== 'object') {
    return {
      bottleneckName: 'None',
      roleName: '',
      capacity: 1,
      capacityStr: '1.0',
      utilization: 0,
      utilizationStr: '0',
      perHr: 0,
      perHrStr: '0.0',
      arrivalPerHr: null,
      arrivalPerHrStr: null,
      status: null,
      isOverloaded: false,
      isTight: false,
      tight: null,
    };
  }

  // 1. Resolve primary bottleneck step/task name
  let rawBn = result.performance_metrics_kpi?.primary_bottleneck ?? result.bottleneck;
  let bnName = null;

  if (rawBn && typeof rawBn === 'object') {
    bnName = extractSafeString(rawBn);
  } else if (typeof rawBn === 'string' && rawBn !== 'None') {
    const mapped = idToLabel[rawBn];
    bnName = extractSafeString(mapped, rawBn);
  }

  if (!bnName && result.bottleneck_identification) {
    const entries = Object.entries(result.bottleneck_identification);
    if (entries.length > 0) {
      const sorted = entries.sort((a, b) => (b[1]?.bottleneck_score || 0) - (a[1]?.bottleneck_score || 0));
      const topKey = sorted[0]?.[0];
      if (topKey && (sorted[0][1]?.bottleneck_score > 0 || sorted[0][1]?.wait_time_avg > 0)) {
        const mapped = idToLabel[topKey];
        bnName = extractSafeString(mapped, topKey);
      }
    }
  }

  if (!bnName && Array.isArray(result.bottlenecks) && result.bottlenecks.length > 0) {
    bnName = extractSafeString(result.bottlenecks[0]);
  }

  const bottleneckName = (typeof bnName === 'string' && bnName.trim()) ? bnName.trim() : 'None';

  // 2. Resolve resource utilization & tightest resource
  let tight = null;
  const resUtil = result.resource_utilization;
  const entries = Array.isArray(resUtil)
    ? resUtil.map((u, i) => [u?.name ?? u?.resource?.name ?? `Resource ${i + 1}`, u])
    : Object.entries(resUtil || {});

  entries.forEach(([rawKey, u]) => {
    if (!u || typeof u !== 'object') return;
    const busy = extractSafeNumber(u.avg_busy_time_per_item, 0);
    if (busy <= 0) return;

    // Handle capacity: number | { current, max } | { value }
    const capNum = Math.max(1, extractSafeNumber(u.capacity, 1));

    // Handle resource name: string | { name, id }
    let rName = '';
    if (u.name) {
      rName = extractSafeString(u.name);
    } else if (u.resource) {
      rName = extractSafeString(u.resource);
    }
    if (!rName) {
      rName = extractSafeString(rawKey, 'Staff');
    }

    // Handle utilization: number | { pct } | { value }
    const utilNum = extractSafeNumber(u.utilization_pct ?? u.utilization, 0);
    const perHr = (capNum * 60) / busy;

    if (!tight || perHr < tight.perHr) {
      tight = {
        name: rName,
        cap: capNum,
        perHr: Number.isFinite(perHr) ? perHr : 0,
        util: Number.isFinite(utilNum) ? utilNum : 0,
      };
    }
  });

  // 3. Resolve arrival rate
  let rawArrival = result.arrival_rate;
  let arrivalRateVal = 0;
  if (typeof rawArrival === 'number') {
    arrivalRateVal = rawArrival;
  } else if (rawArrival && typeof rawArrival === 'object') {
    arrivalRateVal = extractSafeNumber(rawArrival.rate ?? rawArrival.value ?? (rawArrival.per_hour ? rawArrival.per_hour / 60 : 0));
  }
  const arrivalPerHr = arrivalRateVal > 0 ? arrivalRateVal * 60 : null;

  // 4. Determine status
  let status = null;
  if (tight) {
    if ((arrivalPerHr != null && arrivalPerHr > tight.perHr) || tight.util >= 95) status = 'overloaded';
    else if ((arrivalPerHr != null && arrivalPerHr > tight.perHr * 0.85) || tight.util >= 85) status = 'tight';
    else status = 'ok';
  }

  const roleName = tight ? tight.name : '';
  const cap = tight ? tight.cap : 1;
  const perHr = tight ? tight.perHr : 0;
  const util = tight ? tight.util : 0;

  return {
    bottleneckName,
    roleName,
    capacity: cap,
    capacityStr: cap.toFixed(1),
    utilization: util,
    utilizationStr: util.toFixed(0),
    perHr,
    perHrStr: perHr.toFixed(1),
    arrivalPerHr,
    arrivalPerHrStr: arrivalPerHr != null ? arrivalPerHr.toFixed(1) : null,
    status,
    isOverloaded: status === 'overloaded',
    isTight: status === 'tight',
    tight: tight ? {
      name: roleName,
      cap,
      perHr,
      util,
    } : null,
  };
}

/**
 * Prepares results for what-if comparison to ensure all bottleneck fields are plain strings.
 */
export function prepareResultForMetrics(res, idToLabel = {}) {
  if (!res || typeof res !== 'object') return res;
  const view = getBottleneckView(res, idToLabel);
  return {
    ...res,
    bottleneck: view.bottleneckName,
    performance_metrics_kpi: {
      ...(res.performance_metrics_kpi || {}),
      primary_bottleneck: view.bottleneckName,
    },
  };
}

/**
 * Deduplicates scenario list by identity (_backendId || _id || id).
 */
export function dedupeScenarios(list = []) {
  if (!Array.isArray(list)) return [];
  const seenIds = new Set();
  const deduped = [];

  for (const s of list) {
    if (!s) continue;
    const isBase = s._isBaseline || s.id === 'baseline';
    const key = isBase ? 'baseline' : (s._backendId || s._id || s.id);

    if (key) {
      if (seenIds.has(key)) continue;
      seenIds.add(key);
    }
    deduped.push(s);
  }

  return deduped;
}

/**
 * Upserts incoming scenarios into existing list by matching _backendId || _id || id.
 */
export function upsertScenarios(existingList = [], incomingList = []) {
  const result = [...(Array.isArray(existingList) ? existingList : [])];
  const items = Array.isArray(incomingList) ? incomingList : [incomingList];

  for (const item of items) {
    if (!item) continue;
    const isBase = item._isBaseline || item.id === 'baseline';
    const itemId = item._backendId || item._id || item.id;

    const existingIndex = result.findIndex(s => {
      if (isBase) return s._isBaseline || s.id === 'baseline';
      const sId = s._backendId || s._id || s.id;
      return Boolean(sId && itemId && sId === itemId);
    });

    if (existingIndex >= 0) {
      result[existingIndex] = { ...result[existingIndex], ...item };
    } else {
      result.push(item);
    }
  }

  return dedupeScenarios(result);
}
