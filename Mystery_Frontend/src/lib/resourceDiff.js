/**
 * shared/resourceDiff.js / Mystery_Frontend/src/lib/resourceDiff.js
 *
 * Computes exact diffs between baseline model and scenario model for
 * both resources and task durations.
 *
 * Rules:
 * - Resources are matched by stable single identity across baseline and scenario:
 *   matching by ID, name, displayName, or cross-matching ID to Name.
 * - Resource changes are ONLY reported when count, cost/hr, or schedule/shift actually differs.
 * - No raw IDs (res_0...) appear in user-facing summaries.
 * - Task changes detect duration edits on task nodes, reporting old -> new (pct%).
 */

const TASK_TYPES = new Set([
  'task', 'user-task', 'service-task', 'script-task', 'manual-task',
  'send-task', 'receive-task', 'business-rule-task',
  'subprocess', 'call-activity'
]);

function cleanStr(val) {
  if (val == null) return '';
  return String(val).trim();
}

function isGenericId(val) {
  const s = cleanStr(val).toLowerCase();
  if (!s || s === 'unknown_res' || s === 'unnamed resource' || s === 'none' || s === 'null') {
    return true;
  }
  if (s.startsWith('res_') && /\d/.test(s)) {
    return true;
  }
  return false;
}

function getResourceName(res, fallbackName = '') {
  if (!res || typeof res !== 'object') return cleanStr(res);
  for (const field of ['name', 'displayName', 'label']) {
    const val = cleanStr(res[field]);
    if (val && !isGenericId(val)) return val;
  }
  if (fallbackName && !isGenericId(fallbackName)) return fallbackName;
  for (const field of ['name', 'displayName', 'label', 'id']) {
    const val = cleanStr(res[field]);
    if (val) return val;
  }
  return 'Staff / Specialist';
}

function normalizeResourcesList(resources) {
  if (!resources) return [];
  if (Array.isArray(resources)) {
    return resources.map((r, idx) => {
      if (!r || typeof r !== 'object') {
        const s = cleanStr(r);
        return { id: s, name: s, displayName: s, quantity: 1, type: 'staff' };
      }
      const copy = { ...r };
      if (!copy.name && copy.displayName) copy.name = copy.displayName;
      return copy;
    });
  }
  if (typeof resources === 'object') {
    return Object.entries(resources).map(([name, qty]) => ({
      id: cleanStr(name),
      name: cleanStr(name),
      displayName: cleanStr(name),
      quantity: Number(qty) || 1,
      type: 'staff'
    }));
  }
  return [];
}

function extractTaskAssignments(processDoc) {
  const assignments = {};
  const nodes = Array.isArray(processDoc?.nodes) ? processDoc.nodes : [];

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const nType = String(node.type || '').toLowerCase();
    if (!TASK_TYPES.has(nType) && !nType.includes('task') && !nType.includes('activity')) continue;

    const data = node.data && typeof node.data === 'object' ? node.data : node;
    const taskLabel = cleanStr(data.label || node.label || data.name || node.name || node.id || 'Task');

    if (data.resources && typeof data.resources === 'object' && !Array.isArray(data.resources)) {
      for (const [rKey, qty] of Object.entries(data.resources)) {
        if (!rKey || rKey.startsWith('$') || rKey.startsWith('_')) continue;
        const numQty = Number(qty);
        if (Number.isFinite(numQty) && numQty <= 0) continue;
        const normKey = String(rKey).trim().toLowerCase();
        if (!assignments[normKey]) assignments[normKey] = [];
        if (!assignments[normKey].includes(taskLabel)) assignments[normKey].push(taskLabel);
      }
    }

    for (const field of ['resource', 'resource_id']) {
      const val = data[field];
      if (val && typeof val === 'string' && val.trim()) {
        const normKey = val.trim().toLowerCase();
        if (!assignments[normKey]) assignments[normKey] = [];
        if (!assignments[normKey].includes(taskLabel)) assignments[normKey].push(taskLabel);
      }
    }
  }

  return assignments;
}

function getAssignedTasksForResource(assignments, res) {
  const tasks = [];
  const keys = ['id', 'name', 'displayName']
    .map(f => cleanStr(res[f]).toLowerCase())
    .filter(Boolean);

  for (const k of keys) {
    for (const t of (assignments[k] || [])) {
      if (!tasks.includes(t)) tasks.push(t);
    }
  }
  return tasks;
}

function getHourlyRate(res) {
  if (!res || typeof res !== 'object') return 0;
  if (res.cost_per_hour != null && Number.isFinite(Number(res.cost_per_hour))) {
    return Number(res.cost_per_hour);
  }
  if (res.hourly_rate != null && Number.isFinite(Number(res.hourly_rate))) {
    return Number(res.hourly_rate);
  }
  const type = res.type || 'staff';
  const hoursPerDay = Number(res.hours_per_day) > 0 ? Number(res.hours_per_day) : 8;
  const workingDays = Number(res.working_days_per_month) > 0 ? Number(res.working_days_per_month) : 22;
  const monthlyHours = hoursPerDay * workingDays;

  if (type === 'staff') {
    const salary = Number(res.monthly_salary) || 0;
    return monthlyHours > 0 ? salary / monthlyHours : 0;
  }
  if (type === 'equipment' || type === 'vehicle') {
    const price = Number(res.purchase_price) || 0;
    const lifespan = Number(res.lifespan_months) > 0 ? Number(res.lifespan_months) : 1;
    const runningCost = Number(res.monthly_running_cost) || 0;
    const monthlyEquip = (price / lifespan) + runningCost;
    return monthlyHours > 0 ? monthlyEquip / monthlyHours : 0;
  }
  if (type === 'facility') {
    const rent = Number(res.monthly_rent) || 0;
    if (rent > 0) return monthlyHours > 0 ? rent / monthlyHours : 0;
    const price = Number(res.purchase_price) || 0;
    const lifespan = Number(res.lifespan_months) > 0 ? Number(res.lifespan_months) : 1;
    return monthlyHours > 0 ? (price / lifespan) / monthlyHours : 0;
  }
  return 0;
}

function matchResource(bRes, scenResources, matchedScenIndices) {
  const bId = cleanStr(bRes.id).toLowerCase();
  const bName = cleanStr(bRes.name || bRes.displayName).toLowerCase();

  // 1. Non-generic ID match
  if (bId && !isGenericId(bId)) {
    for (let idx = 0; idx < scenResources.length; idx++) {
      if (matchedScenIndices.has(idx)) continue;
      const sId = cleanStr(scenResources[idx].id).toLowerCase();
      if (sId && sId === bId) return [idx, scenResources[idx]];
    }
  }

  // 2. Non-generic Name match
  if (bName && !isGenericId(bName)) {
    for (let idx = 0; idx < scenResources.length; idx++) {
      if (matchedScenIndices.has(idx)) continue;
      const sName = cleanStr(scenResources[idx].name || scenResources[idx].displayName).toLowerCase();
      if (sName && sName === bName) return [idx, scenResources[idx]];
    }
  }

  // 3. Cross match b.name == s.id or b.id == s.name
  for (let idx = 0; idx < scenResources.length; idx++) {
    if (matchedScenIndices.has(idx)) continue;
    const sId = cleanStr(scenResources[idx].id).toLowerCase();
    const sName = cleanStr(scenResources[idx].name || scenResources[idx].displayName).toLowerCase();

    if (bName && !isGenericId(bName) && sId && sId === bName) {
      return [idx, scenResources[idx]];
    }
    if (bId && !isGenericId(bId) && sName && sName === bId) {
      return [idx, scenResources[idx]];
    }
  }

  // 4. Fallback exact ID match even if generic (e.g. res_0 == res_0)
  if (bId) {
    for (let idx = 0; idx < scenResources.length; idx++) {
      if (matchedScenIndices.has(idx)) continue;
      const sId = cleanStr(scenResources[idx].id).toLowerCase();
      if (sId && sId === bId) return [idx, scenResources[idx]];
    }
  }

  return null;
}

/**
 * Computes exact diffs between baseline model resources and scenario resources.
 * Only reports changes when count, cost/hr, or schedule actually differs.
 */
export function computeResourceChanges(baselineProcess, scenarioProcess) {
  const baseResources = normalizeResourcesList(baselineProcess?.resources);
  const scenResources = normalizeResourcesList(scenarioProcess?.resources);

  const baseAssignments = extractTaskAssignments(baselineProcess);
  const scenAssignments = extractTaskAssignments(scenarioProcess);

  const changes = [];
  const matchedScenIndices = new Set();

  for (let idx = 0; idx < baseResources.length; idx++) {
    const bRes = baseResources[idx];
    const bTasks = getAssignedTasksForResource(baseAssignments, bRes);
    const bName = getResourceName(bRes);
    const bId = cleanStr(bRes.id || bName);

    const match = matchResource(bRes, scenResources, matchedScenIndices);

    if (!match) {
      // Resource removed
      const bQty = Number(bRes.quantity != null ? bRes.quantity : 1);
      const displayName = !isGenericId(bName) ? bName : (bTasks[0] ? `${bTasks[0]} Staff` : 'Staff');
      changes.push({
        id: bId,
        resource_id: bId,
        name: displayName,
        property: 'count',
        property_label: 'Count',
        before: bQty,
        after: 0,
        delta: -bQty,
        delta_text: `-${bQty}`,
        direction: 'removed',
        change_text: `${displayName}: removed (was ${bQty})`,
        summary: `${displayName}: ${bQty} → 0 (-${bQty})`,
        affected_tasks: bTasks,
        tasks_display: bTasks.length > 0 ? bTasks.join(', ') : 'None',
      });
      continue;
    }

    const [sIdx, sRes] = match;
    matchedScenIndices.add(sIdx);

    const sName = getResourceName(sRes, bName);
    const displayName = !isGenericId(sName) ? sName : getResourceName(bRes);
    const sTasks = getAssignedTasksForResource(scenAssignments, sRes);
    const allAffectedTasks = Array.from(new Set([...bTasks, ...sTasks])).sort();
    const tasksDisplay = allAffectedTasks.length > 0 ? allAffectedTasks.join(', ') : 'None';

    // 1. Rename check (only if neither is a generic ID and names actually differ)
    if (bName.trim().toLowerCase() !== sName.trim().toLowerCase() && !isGenericId(bName) && !isGenericId(sName)) {
      changes.push({
        id: bId,
        resource_id: bId,
        name: sName,
        property: 'name',
        property_label: 'Name',
        before: bName,
        after: sName,
        delta: 0,
        delta_text: 'renamed',
        direction: 'edit',
        change_text: `${bName}: renamed to "${sName}"`,
        summary: `${bName} → ${sName} (renamed)`,
        affected_tasks: allAffectedTasks,
        tasks_display: tasksDisplay,
      });
    }

    // 2. Count check
    const bQty = Number(bRes.quantity != null ? bRes.quantity : 1);
    const sQty = Number(sRes.quantity != null ? sRes.quantity : 1);
    if (bQty !== sQty) {
      const diff = sQty - bQty;
      const direction = diff > 0 ? 'increase' : 'decrease';
      const diffSign = diff > 0 ? `+${diff}` : `${diff}`;
      changes.push({
        id: bId,
        resource_id: bId,
        name: displayName,
        property: 'count',
        property_label: 'Count',
        before: bQty,
        after: sQty,
        delta: diff,
        delta_text: diffSign,
        direction,
        change_text: `${displayName}: count ${bQty} → ${sQty} (${diffSign})`,
        summary: `${displayName}: ${bQty} → ${sQty} (${diffSign})`,
        affected_tasks: allAffectedTasks,
        tasks_display: tasksDisplay,
      });
    }

    // 3. Cost per hour check
    const bRate = Math.round(getHourlyRate(bRes) * 100) / 100;
    const sRate = Math.round(getHourlyRate(sRes) * 100) / 100;
    if (bRate !== sRate) {
      const diffCost = Math.round((sRate - bRate) * 100) / 100;
      const direction = diffCost > 0 ? 'increase' : 'decrease';
      const bStr = Number.isInteger(bRate) ? `$${bRate}` : `$${bRate.toFixed(2)}`;
      const sStr = Number.isInteger(sRate) ? `$${sRate}` : `$${sRate.toFixed(2)}`;
      const diffSign = Number.isInteger(diffCost)
        ? (diffCost > 0 ? `+$${diffCost}` : `-$${Math.abs(diffCost)}`)
        : (diffCost > 0 ? `+$${diffCost.toFixed(2)}` : `-$${Math.abs(diffCost).toFixed(2)}`);
      changes.push({
        id: bId,
        resource_id: bId,
        name: displayName,
        property: 'cost_per_hour',
        property_label: 'Cost / hr',
        before: bStr,
        after: sStr,
        delta: diffCost,
        delta_text: diffSign,
        direction: 'edit',
        change_text: `${displayName}: cost/hr ${bStr} → ${sStr} (${diffSign})`,
        summary: `${displayName}: cost/hr ${bStr} → ${sStr}`,
        affected_tasks: allAffectedTasks,
        tasks_display: tasksDisplay,
      });
    }

    // 4. Schedule / Shift check
    const bHpd = bRes.hours_per_day != null ? Number(bRes.hours_per_day) : 8;
    const sHpd = sRes.hours_per_day != null ? Number(sRes.hours_per_day) : 8;
    const bWdm = bRes.working_days_per_month != null ? Number(bRes.working_days_per_month) : 22;
    const sWdm = sRes.working_days_per_month != null ? Number(sRes.working_days_per_month) : 22;

    if ((bHpd !== sHpd || bWdm !== sWdm) && (bRes.hours_per_day != null || sRes.hours_per_day != null)) {
      const bStr = `${bHpd}h/day, ${bWdm}d/mo`;
      const sStr = `${sHpd}h/day, ${sWdm}d/mo`;
      changes.push({
        id: bId,
        resource_id: bId,
        name: displayName,
        property: 'schedule_shift',
        property_label: 'Schedule / Shift',
        before: bStr,
        after: sStr,
        delta: 0,
        delta_text: 'modified',
        direction: 'edit',
        change_text: `${displayName}: schedule ${bStr} → ${sStr}`,
        summary: `${displayName}: schedule ${bStr} → ${sStr}`,
        affected_tasks: allAffectedTasks,
        tasks_display: tasksDisplay,
      });
    }
  }

  // Check for NEW resources in scenario
  scenResources.forEach((sRes, idx) => {
    if (matchedScenIndices.has(idx)) return;
    const sName = getResourceName(sRes);
    const sId = cleanStr(sRes.id || sName);
    const sQty = Number(sRes.quantity != null ? sRes.quantity : 1);
    const sTasks = getAssignedTasksForResource(scenAssignments, sRes);
    changes.push({
      id: sId,
      resource_id: sId,
      name: sName,
      property: 'count',
      property_label: 'New Resource',
      before: '—',
      after: sQty,
      delta: sQty,
      delta_text: `+${sQty}`,
      direction: 'new',
      change_text: `${sName}: new resource (count: ${sQty})`,
      summary: `${sName}: +${sQty} (new)`,
      affected_tasks: sTasks,
      tasks_display: sTasks.length > 0 ? sTasks.join(', ') : 'None',
    });
  });

  return changes;
}

function taskDurationInfo(node) {
  const data = node?.data && typeof node.data === 'object' ? node.data : node || {};
  let unit = data.duration_unit || node?.duration_unit || 'min';
  if (unit.startsWith('minute')) unit = 'min';

  const dMin = data.duration_min;
  const dMax = data.duration_max;
  const d = data.duration;

  if (dMin !== undefined && dMin !== null && dMax !== undefined && dMax !== null) {
    return [Math.round(Number(dMin) * 100) / 100, Math.round(Number(dMax) * 100) / 100, unit, true];
  }
  if (d !== undefined && d !== null) {
    return [Math.round(Number(d) * 100) / 100, null, unit, false];
  }
  return [null, null, unit, false];
}

/**
 * Computes duration changes on task nodes between baseline and scenario.
 * Format example: "Triage and check vitals: 6 → 3 min (-50%)"
 */
export function computeTaskChanges(baselineProcess, scenarioProcess) {
  const baseNodes = Array.isArray(baselineProcess?.nodes) ? baselineProcess.nodes : [];
  const scenNodes = Array.isArray(scenarioProcess?.nodes) ? scenarioProcess.nodes : [];

  const baseMap = new Map();
  for (const n of baseNodes) {
    if (n && n.id) {
      baseMap.set(String(n.id).trim().toLowerCase(), n);
    }
  }

  const taskChanges = [];

  for (const sNode of scenNodes) {
    if (!sNode || !sNode.id) continue;
    const nid = String(sNode.id).trim().toLowerCase();
    const bNode = baseMap.get(nid);
    if (!bNode) continue;

    const rawType = String(sNode.type || 'task').toLowerCase().trim();
    if (!TASK_TYPES.has(rawType) && !rawType.includes('task') && !rawType.includes('activity')) continue;

    const [bMin, bMax, bUnit, bIsRange] = taskDurationInfo(bNode);
    const [sMin, sMax, sUnit, sIsRange] = taskDurationInfo(sNode);

    if (bMin === null || sMin === null) continue;

    const data = sNode.data && typeof sNode.data === 'object' ? sNode.data : sNode;
    const bData = bNode.data && typeof bNode.data === 'object' ? bNode.data : bNode;
    const label = cleanStr(data.label || sNode.label || bData.label || bNode.label || sNode.id);

    if (!bIsRange && !sIsRange) {
      if (bMin !== sMin) {
        const pct = bMin > 0 ? Math.round(((sMin - bMin) / bMin) * 100) : 0;
        const pctSign = pct > 0 ? `+${pct}%` : `${pct}%`;
        const direction = sMin < bMin ? 'decrease' : 'increase';
        taskChanges.push({
          id: sNode.id,
          task: label,
          property: 'duration',
          property_label: 'Duration',
          before: `${bMin} ${bUnit}`,
          after: `${sMin} ${bUnit}`,
          delta_pct: pct,
          delta_text: pctSign,
          direction,
          summary: `${label}: ${bMin} → ${sMin} ${bUnit} (${pctSign})`,
        });
      }
    } else {
      const bLow = bMin;
      const bHigh = bMax != null ? bMax : bMin;
      const sLow = sMin;
      const sHigh = sMax != null ? sMax : sMin;

      if (bLow !== sLow || bHigh !== sHigh) {
        const avgB = (bLow + bHigh) / 2.0;
        const avgS = (sLow + sHigh) / 2.0;
        const pct = avgB > 0 ? Math.round(((avgS - avgB) / avgB) * 100) : 0;
        const pctSign = pct > 0 ? `+${pct}%` : `${pct}%`;
        const direction = avgS < avgB ? 'decrease' : 'increase';
        taskChanges.push({
          id: sNode.id,
          task: label,
          property: 'duration',
          property_label: 'Duration',
          before: `${bLow}-${bHigh} ${bUnit}`,
          after: `${sLow}-${sHigh} ${bUnit}`,
          delta_pct: pct,
          delta_text: pctSign,
          direction,
          summary: `${label}: ${bLow}-${bHigh} → ${sLow}-${sHigh} ${bUnit} (${pctSign})`,
        });
      }
    }
  }

  return taskChanges;
}

export function computeAllChanges(baselineProcess, scenarioProcess) {
  return {
    resource_changes: computeResourceChanges(baselineProcess, scenarioProcess),
    task_changes: computeTaskChanges(baselineProcess, scenarioProcess),
  };
}
