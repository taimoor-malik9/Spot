/**
 * shared/resourceDiff.js
 *
 * Computes exact diffs between baseline model resources and scenario resources.
 * Matched strictly by ID so renames are detected as renames rather than remove + add.
 */

const TASK_TYPES = new Set([
  'task', 'user-task', 'service-task', 'script-task', 'manual-task',
  'send-task', 'receive-task', 'business-rule-task',
  'subprocess', 'call-activity'
]);

function getResourceId(res, fallbackIdx) {
  if (!res || typeof res !== 'object') return String(res || '').trim();
  const id = res.id || res._id;
  if (id != null && String(id).trim()) return String(id).trim();
  const name = res.name || res.displayName;
  if (name != null && String(name).trim()) return String(name).trim();
  return fallbackIdx != null ? `res_${fallbackIdx}` : 'unknown_res';
}

function getResourceName(res) {
  if (!res || typeof res !== 'object') return String(res || '');
  return String(res.displayName || res.name || res.id || 'Unnamed Resource').trim();
}

function normalizeResourcesList(resources) {
  if (!resources) return [];
  if (Array.isArray(resources)) {
    return resources.map((r, idx) => {
      if (!r || typeof r !== 'object') {
        const str = String(r || '').trim();
        return { id: str || `res_${idx}`, name: str, displayName: str, quantity: 1, type: 'staff' };
      }
      const copy = { ...r };
      if (!copy.id) copy.id = copy.name || `res_${idx}`;
      return copy;
    });
  }
  if (typeof resources === 'object') {
    return Object.entries(resources).map(([name, qty]) => ({
      id: name,
      name,
      displayName: name,
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
    const taskLabel = String(data.label || node.label || data.name || node.name || node.id || 'Task').trim();

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
  const keys = [
    res.id ? String(res.id).trim().toLowerCase() : null,
    res.name ? String(res.name).trim().toLowerCase() : null,
    res.displayName ? String(res.displayName).trim().toLowerCase() : null,
  ].filter(Boolean);

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

/**
 * Computes exact diffs between baseline model resources and scenario resources.
 *
 * @param {object} baselineProcess
 * @param {object} scenarioProcess
 * @returns {Array<object>} resource_changes list
 */
export function computeResourceChanges(baselineProcess, scenarioProcess) {
  const baseResources = normalizeResourcesList(baselineProcess?.resources);
  const scenResources = normalizeResourcesList(scenarioProcess?.resources);

  const baseAssignments = extractTaskAssignments(baselineProcess);
  const scenAssignments = extractTaskAssignments(scenarioProcess);

  const baseById = new Map();
  const baseByName = new Map();
  baseResources.forEach((r, idx) => {
    const id = getResourceId(r, idx);
    baseById.set(id, r);
    const name = getResourceName(r).toLowerCase();
    if (name) baseByName.set(name, r);
  });

  const scenById = new Map();
  const scenByName = new Map();
  scenResources.forEach((r, idx) => {
    const id = getResourceId(r, idx);
    scenById.set(id, r);
    const name = getResourceName(r).toLowerCase();
    if (name) scenByName.set(name, r);
  });

  const changes = [];
  const matchedScenIds = new Set();

  baseResources.forEach((bRes, idx) => {
    const bId = getResourceId(bRes, idx);
    const bName = getResourceName(bRes);
    const bTasks = getAssignedTasksForResource(baseAssignments, bRes);

    let sRes = scenById.get(bId);
    if (!sRes) {
      sRes = scenByName.get(bName.toLowerCase());
    }

    if (!sRes) {
      // Resource removed
      const bQty = Number(bRes.quantity) || 1;
      changes.push({
        id: bId,
        resource_id: bId,
        name: bName,
        property: 'count',
        property_label: 'Count',
        before: bQty,
        after: 0,
        delta: -bQty,
        delta_text: `-${bQty}`,
        direction: 'removed',
        change_text: `${bName}: removed (was ${bQty})`,
        summary: `${bName}: ${bQty} → 0 (-${bQty})`,
        affected_tasks: bTasks,
        tasks_display: bTasks.length > 0 ? bTasks.join(', ') : 'None',
      });
      return;
    }

    const sId = getResourceId(sRes);
    matchedScenIds.add(sId);
    const sName = getResourceName(sRes);
    const sTasks = getAssignedTasksForResource(scenAssignments, sRes);
    const allAffectedTasks = Array.from(new Set([...bTasks, ...sTasks])).sort();
    const tasksDisplay = allAffectedTasks.length > 0 ? allAffectedTasks.join(', ') : 'None';

    // 1. Rename check (matched by ID, name differs)
    if (bName.trim().toLowerCase() !== sName.trim().toLowerCase()) {
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
        name: sName,
        property: 'count',
        property_label: 'Count',
        before: bQty,
        after: sQty,
        delta: diff,
        delta_text: diffSign,
        direction,
        change_text: `${sName}: count ${bQty} → ${sQty} (${diffSign})`,
        summary: `${sName}: ${bQty} → ${sQty} (${diffSign})`,
        affected_tasks: allAffectedTasks,
        tasks_display: tasksDisplay,
      });
    }

    // 3. Cost per hour check
    const bRate = Math.round(getHourlyRate(bRes) * 100) / 100;
    const sRate = Math.round(getHourlyRate(sRes) * 100) / 100;
    if (Math.abs(bRate - sRate) >= 0.01) {
      const rateDiff = Math.round((sRate - bRate) * 100) / 100;
      const rateDiffSign = rateDiff > 0 ? `+$${rateDiff}` : `-$${Math.abs(rateDiff)}`;
      const direction = 'edit';
      changes.push({
        id: bId,
        resource_id: bId,
        name: sName,
        property: 'cost_per_hour',
        property_label: 'Cost / hr',
        before: `$${bRate}`,
        after: `$${sRate}`,
        delta: rateDiff,
        delta_text: rateDiffSign,
        direction,
        change_text: `${sName}: cost/hr $${bRate} → $${sRate} (${rateDiffSign})`,
        summary: `${sName}: cost/hr $${bRate} → $${sRate}`,
        affected_tasks: allAffectedTasks,
        tasks_display: tasksDisplay,
      });
    }

    // 4. Schedule / Shift check
    const bHpd = bRes.hours_per_day;
    const sHpd = sRes.hours_per_day;
    const bWd = bRes.working_days_per_month;
    const sWd = sRes.working_days_per_month;
    const bShift = bRes.shift || bRes.schedule;
    const sShift = sRes.shift || sRes.schedule;

    let schedChanged = false;
    const bSched = [];
    const sSched = [];
    if (bHpd !== sHpd && (bHpd != null || sHpd != null)) {
      schedChanged = true;
      bSched.push(bHpd != null ? `${bHpd}h/day` : 'default');
      sSched.push(sHpd != null ? `${sHpd}h/day` : 'default');
    }
    if (bWd !== sWd && (bWd != null || sWd != null)) {
      schedChanged = true;
      bSched.push(bWd != null ? `${bWd}d/mo` : 'default');
      sSched.push(sWd != null ? `${sWd}d/mo` : 'default');
    }
    if (bShift !== sShift && (bShift || sShift)) {
      schedChanged = true;
      bSched.push(String(bShift || 'standard'));
      sSched.push(String(sShift || 'standard'));
    }

    if (schedChanged) {
      const bStr = bSched.join(', ');
      const sStr = sSched.join(', ');
      changes.push({
        id: bId,
        resource_id: bId,
        name: sName,
        property: 'schedule_shift',
        property_label: 'Schedule / Shift',
        before: bStr,
        after: sStr,
        delta: 0,
        delta_text: 'modified',
        direction: 'edit',
        change_text: `${sName}: schedule ${bStr} → ${sStr}`,
        summary: `${sName}: schedule ${bStr} → ${sStr}`,
        affected_tasks: allAffectedTasks,
        tasks_display: tasksDisplay,
      });
    }

    // 5. Assigned tasks changed
    const bTaskSet = new Set(bTasks);
    const sTaskSet = new Set(sTasks);
    if (bTasks.length !== sTasks.length || bTasks.some(t => !sTaskSet.has(t))) {
      const added = sTasks.filter(t => !bTaskSet.has(t));
      const removed = bTasks.filter(t => !sTaskSet.has(t));
      const bTasksStr = bTasks.length > 0 ? bTasks.join(', ') : 'None';
      const sTasksStr = sTasks.length > 0 ? sTasks.join(', ') : 'None';
      const direction = added.length > removed.length ? 'increase' : (removed.length > added.length ? 'decrease' : 'edit');
      const details = [];
      if (added.length > 0) details.push(`+${added.join(', ')}`);
      if (removed.length > 0) details.push(`-${removed.join(', ')}`);
      const deltaDetail = details.join('; ');
      changes.push({
        id: bId,
        resource_id: bId,
        name: sName,
        property: 'assigned_tasks',
        property_label: 'Assigned Tasks',
        before: bTasksStr,
        after: sTasksStr,
        delta: sTasks.length - bTasks.length,
        delta_text: deltaDetail,
        direction,
        change_text: `${sName}: assigned tasks ${bTasksStr} → ${sTasksStr}`,
        summary: `${sName}: assigned tasks changed (${deltaDetail})`,
        affected_tasks: allAffectedTasks,
        tasks_display: tasksDisplay,
      });
    }
  });

  // Check for NEW resources added in scenario
  scenResources.forEach((sRes, idx) => {
    const sId = getResourceId(sRes, idx);
    if (matchedScenIds.has(sId)) return;
    const sName = getResourceName(sRes);
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
