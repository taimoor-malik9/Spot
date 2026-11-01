/**
 * Mystery_Frontend/src/lib/durationRules.js
 *
 * Module D1b: Duration rules based on WHY an activity exists.
 */

export const TASK_TYPES = new Set([
  'task',
  'user-task',
  'service-task',
  'script-task',
  'manual-task',
  'send-task',
  'receive-task',
  'business-rule-task',
  'subprocess',
  'call-activity',
]);

export function isTaskType(type) {
  if (!type) return false;
  const t = String(type).trim().toLowerCase();
  return TASK_TYPES.has(t) || t.endsWith('-task');
}

/**
 * Auto-normalize ranges:
 * - Swap min/max if reversed
 * - min = Math.min(min, duration) if duration is present
 * - max = Math.max(max, duration) if duration is present
 */
export function normalizeRanges(data) {
  if (!data || typeof data !== 'object') return data;
  let d = data.duration != null && !isNaN(Number(data.duration)) ? Number(data.duration) : null;
  let min = data.duration_min != null && !isNaN(Number(data.duration_min)) ? Number(data.duration_min) : null;
  let max = data.duration_max != null && !isNaN(Number(data.duration_max)) ? Number(data.duration_max) : null;

  if (min != null && max != null && min > max) {
    const tmp = min;
    min = max;
    max = tmp;
  }

  if (d != null) {
    if (min != null) min = Math.min(min, d);
    if (max != null) max = Math.max(max, d);
  }

  return {
    ...data,
    duration: d,
    duration_min: min,
    duration_max: max,
  };
}

/**
 * Validates process nodes according to Module D1b duration rules.
 *
 * @param {Array} nodes
 * @returns {{
 *   errors: Array<{ nodeId: string, label: string, message: string }>,
 *   unresolvedInferred: Array<{ nodeId: string, label: string, message: string }>,
 *   errorNodeIds: Set<string>,
 *   summary: string
 * }}
 */
export function validateDurationRules(nodes) {
  const errors = [];
  const unresolvedInferred = [];
  const errorNodeIds = new Set();

  if (!Array.isArray(nodes)) {
    return { errors, unresolvedInferred, errorNodeIds, summary: '0 steps need a duration' };
  }

  nodes.forEach(node => {
    if (!node || typeof node !== 'object') return;
    if (!isTaskType(node.type)) return; // Task-type nodes only. Events and gateways legitimately have 0.

    const d = node.data && typeof node.data === 'object' ? node.data : node;
    // Nodes saved before this change have no origin: treat them as "user"
    const origin = d.origin || node.origin || 'user';
    const kept = d.kept !== undefined ? Boolean(d.kept) : (node.kept !== undefined ? Boolean(node.kept) : false);
    const estimated = Boolean(d.estimated ?? node.estimated);
    const label = d.label || node.label || node.id;

    // Rule: origin structural is always exempt (duration 0, null min/max, no resources OK)
    if (origin === 'structural') {
      return;
    }

    // Rule: origin inferred and not kept: zero time, exempt from the duration error. Count as unresolved.
    if (origin === 'inferred' && !kept) {
      unresolvedInferred.push({
        nodeId: node.id,
        label,
        message: 'AI suggested this step: Keep or Remove',
      });
      return;
    }

    // Rule: origin stated or user, or kept === true: duration > 0 is REQUIRED.
    const normalized = normalizeRanges(d);
    const hasFixed = normalized.duration != null && normalized.duration > 0;
    const hasRange = normalized.duration_max != null && normalized.duration_max > 0;
    // A value from the intake "Not sure" choice is stored with estimated:true and counts as set, tagged "estimated"
    const isSet = hasFixed || hasRange || (estimated && normalized.duration != null && normalized.duration > 0);

    if (!isSet) {
      errors.push({
        nodeId: node.id,
        label,
        message: `${label} needs a duration.`,
      });
      errorNodeIds.add(node.id);
    }
  });

  const count = errors.length;
  const summary = `${count} ${count === 1 ? 'step needs' : 'steps need'} a duration`;

  return {
    errors,
    unresolvedInferred,
    errorNodeIds,
    summary,
  };
}
