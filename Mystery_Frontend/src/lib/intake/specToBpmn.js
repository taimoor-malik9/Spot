/**
 * shared/specToBpmn.js
 *
 * Deterministic Stage 2 BPMN diagram generator from a Stage 1 validated Spec.
 *
 * Core Rules:
 *  - Exactly ONE start event per process by default, placed in the lane of the
 *    role that begins the work. Lanes never get their own start. Never create
 *    a start per lane, per trigger, or per flow row.
 *  - The one start is the main arrival (plain start, or message start if an
 *    external party triggers it). It is not followed by a "Wait for ..." step.
 *  - Secondary triggers (reorder, scheduled collection, supplier delivery) are
 *    NOT start events by default. Model them inside the flow:
 *      * condition trigger -> decision point (exclusive gateway) inside the main flow
 *      * waiting on an external party -> intermediate message catch event inside main flow
 *      * waiting on time / scheduled collection -> intermediate timer catch event inside main flow
 *  - Create an additional start event ONLY if trigger.independent is explicitly
 *    true AND confirmed by the user in the questionnaire.
 *  - External parties become separate pools added BEFORE any message flows connect to them.
 *    Sequence flows NEVER cross pool boundaries.
 *  - Intermediate message catch events MUST have an incoming message flow from the external pool.
 *  - Send tasks / message throw events MUST have an outgoing message flow to the external pool.
 *  - Exclusive gateways have all outgoing branches labeled and a matching merge gateway.
 *  - All elements have human-readable names, never internal IDs.
 *  - Activities from the user's description must have duration: null if not stated in text.
 *    Only structural activities added purely for BPMN satisfaction have duration: 0.
 *  - End events must be named after the outcome of the branch (e.g. "Order fulfilled",
 *    "Application rejected"), not generic "Complete".
 */

import { cleanAndNormalizeSpec } from './specSchema.js';
import { areExternalPoolAliases } from './stepListHelper.js';

function sanitizeId(str, prefix = 'node') {
  const slug = String(str || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${prefix}_${slug}`;
}

function resolveTwoBranchProbs(b1, b2) {
  let p1 = b1?.probability != null && !isNaN(Number(b1.probability)) ? Number(b1.probability) : undefined;
  let p2 = b2?.probability != null && !isNaN(Number(b2.probability)) ? Number(b2.probability) : undefined;

  if (p1 != null && p2 == null && p1 >= 0 && p1 <= 1.0) {
    p2 = Number((1.0 - p1).toFixed(2));
  } else if (p2 != null && p1 == null && p2 >= 0 && p2 <= 1.0) {
    p1 = Number((1.0 - p2).toFixed(2));
  } else if (p1 != null && p2 != null) {
    const sum = p1 + p2;
    if (Math.abs(sum - 1.0) > 0.001 && sum > 0) {
      p1 = Number((p1 / sum).toFixed(2));
      p2 = Number((1.0 - p1).toFixed(2));
    }
  }
  return { p1, p2 };
}

function isWaitingOnExternal(activityName, externalParties = []) {
  const lower = activityName.toLowerCase();
  const startsWithWait = /^(receive|wait\s+for|await|waiting\s+for)\b/i.test(activityName);
  if (!startsWithWait) return false;
  const matchesParty = externalParties.some((p) => lower.includes(p.name.toLowerCase()));
  const matchesExternalWord = /delivery|external|partner|notice|message|response|callback/i.test(lower);
  return matchesParty || matchesExternalWord || startsWithWait;
}

function isSendingToExternal(activityName, externalParties = []) {
  const lower = activityName.toLowerCase();
  const startsWithSend = /^(send|submit|place\s+order|order\s+from|request|dispatch|transmit|forward|mail|notify)\b/i.test(activityName);
  if (!startsWithSend) return false;
  const matchesParty = externalParties.some((p) => lower.includes(p.name.toLowerCase()));
  const matchesExternalWord = /external|partner|notice|message|request|submission/i.test(lower);
  return matchesParty || matchesExternalWord;
}

function isTimerWait(activityName) {
  return /^(wait\s+\d+|wait\s+overnight|wait\s+for\s+\d+|delay\s+for|periodic\s+wait)/i.test(activityName);
}

function isRedundantWaitAfterArrival(activityName) {
  if (!activityName) return false;
  return /^(receive|wait\s+for|await|take|accept)\b.*(message|notice|trigger|input|request|item|order|intake|delivery|arrival|submission|payload)/i.test(activityName) ||
         /^(receive\s+order|take\s+order|wait\s+for\s+order|await\s+order|receive\s+application|await\s+request)/i.test(activityName);
}

function deriveOutcomeEndLabel(taskLabel, fallback = 'Process Completed') {
  if (!taskLabel) return fallback;
  const clean = String(taskLabel).trim();

  if (/reject|decline|denied/i.test(clean)) return 'Rejected';
  if (/disburse|grant|fund/i.test(clean)) return 'Funds Disbursed';
  if (/fulfill.*order|deliver.*order|dispatch/i.test(clean)) return 'Order Fulfilled';
  if (/stock.*inventory|replenish/i.test(clean)) return 'Restocked';
  if (/deliver/i.test(clean)) return 'Delivery Completed';
  if (/discharge/i.test(clean)) return 'Patient Discharged';
  if (/treatment|treat/i.test(clean)) return 'Patient Treated';

  const words = clean.split(/\s+/);
  const firstWord = words[0].toLowerCase();
  const rest = words.slice(1).join(' ');

  const verbMap = {
    deliver: 'Delivered',
    fulfill: 'Fulfilled',
    send: 'Sent',
    disburse: 'Disbursed',
    reject: 'Rejected',
    approve: 'Approved',
    stock: 'Stocked',
    administer: 'Administered',
    perform: 'Completed',
    conduct: 'Completed',
    process: 'Processed',
    handle: 'Handled',
    finish: 'Finished',
    close: 'Closed',
    resolve: 'Resolved',
    audit: 'Audited',
    inspect: 'Inspected',
  };

  const pastVerb = verbMap[firstWord] || (firstWord.endsWith('e') ? `${firstWord}d` : `${firstWord}ed`);
  if (rest) {
    const capitalizedRest = rest.charAt(0).toUpperCase() + rest.slice(1);
    const cappedVerb = pastVerb.charAt(0).toUpperCase() + pastVerb.slice(1);
    return `${capitalizedRest} ${cappedVerb}`;
  }
  return `${clean.charAt(0).toUpperCase() + clean.slice(1)} Completed`;
}

/**
 * Derives a concise, clean domain or process title for the main business pool,
 * domain-agnostically ensuring raw prompt sentences like "We take orders from 800+ retailers"
 * are replaced with clean titles without hardcoding domain-specific keywords.
 *
 * @param {string} [description='']
 * @param {object} [spec={}]
 * @returns {string} cleanPoolTitle
 */
export function deriveCleanPoolTitle(description = '', spec = {}) {
  // 1. If spec provides a clean process_name, use it
  if (spec?.process_name && typeof spec.process_name === 'string' && spec.process_name.trim()) {
    const clean = spec.process_name.trim();
    if (clean.length <= 50 && !/^(we\b|i\b|our\b|please\b|this\b)/i.test(clean)) {
      return clean;
    }
  }

  // 2. Check if description has a title prefix before a colon, e.g. "Distribution Business: We take..."
  const rawDesc = String(description || '').trim();
  const firstLine = rawDesc.split('\n')[0] || '';
  if (firstLine.includes(':')) {
    const prefix = firstLine.split(':')[0].trim();
    if (prefix.length >= 3 && prefix.length <= 40 && !/^(step|note|warning|hi|hello|dear|input)\b/i.test(prefix)) {
      return prefix.endsWith('Operations') || prefix.endsWith('Process') ? prefix : `${prefix} Operations`;
    }
  }

  // 3. Extract business name if phrased as "X business" or "X process" or "X operations"
  const businessMatch = rawDesc.match(/(?:business|company|service|operations|flow|process)\s+(?:is|called|named|for)\s+([^.,\n]+)/i) ||
                        rawDesc.match(/(?:welcome to|this is|about)\s+([^.,\n]+)/i);
  if (businessMatch && businessMatch[1]) {
    const candidate = businessMatch[1].trim();
    if (candidate.length >= 3 && candidate.length <= 35) {
      return candidate.endsWith('Operations') || candidate.endsWith('Process') ? candidate : `${candidate} Operations`;
    }
  }

  // 4. Extract from goals or issues if cleanly stated
  if (Array.isArray(spec?.goals_or_issues) && spec.goals_or_issues.length > 0) {
    const goalText = String(spec.goals_or_issues[0]).trim();
    const goalMatch = goalText.match(/(?:optimize|improve|manage|streamline|run)\s+([^.,\n]+)/i);
    if (goalMatch && goalMatch[1]) {
      const candidate = goalMatch[1].trim();
      if (candidate.length >= 3 && candidate.length <= 35 && !/\b(time|cost|waiting|bottleneck)\b/i.test(candidate)) {
        const words = candidate.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        return `${words} Operations`;
      }
    }
  }

  // 5. Fallback: clean snippet from the first sentence
  const cleanSnippet = firstLine
    .replace(/^(we\s+are|we\s+run|we\s+operate|we\s+take|we\s+handle|our\s+business\s+is|this\s+is)\s+/i, '')
    .split(/[.,;]/)[0]
    .trim();

  if (cleanSnippet.length >= 4 && cleanSnippet.length <= 35 && !/\b(take|order|orders|process|work|is|are|have|from|with)\b/i.test(cleanSnippet)) {
    return cleanSnippet.endsWith('Operations') || cleanSnippet.endsWith('Process') ? cleanSnippet : `${cleanSnippet} Operations`;
  }

  return 'Business Operations';
}

/**
 * Generates a valid BPMN diagram from the Stage 1 Spec.
 *
 * @param {object} rawSpec - Validated Stage 1 Spec
 * @param {object} [options]
 * @returns {object} rawDiagram - { type: 'diagram', nodes: [], edges: [], resources: [] }
 */
export function specToBpmn(rawSpec, options = {}) {
  const spec = cleanAndNormalizeSpec(rawSpec);
  const nodes = [];
  const edges = [];
  const resources = [];

  const internalRoles = spec.participants.internal_roles || [];
  const triggers = spec.triggers || [];
  const activities = [...(spec.activities || [])];
  const decisions = spec.decisions || [];

  const descCandidate = options.userDescription || options.description || '';
  const isCleanOptionTitle = options.businessName &&
    !/^(we\b|i\b|our\b|please\b|this\b|\d+)/i.test(options.businessName) &&
    options.businessName.length <= 45 &&
    !/\b(take|order|orders|receive|delivers?)\b/i.test(options.businessName);

  const primaryPoolName = isCleanOptionTitle
    ? options.businessName
    : deriveCleanPoolTitle(descCandidate || options.businessName, spec);
  const primaryPoolId = sanitizeId(primaryPoolName, 'pool');

  // 1. Primary business pool
  nodes.push({
    id: primaryPoolId,
    type: 'pool',
    label: primaryPoolName,
    origin: 'structural',
    data: {
      label: primaryPoolName,
      isExternal: false,
      origin: 'structural',
    },
  });

  // Swimlanes for internal roles
  const laneRoleMap = new Map();
  if (internalRoles.length > 0) {
    internalRoles.forEach((role, idx) => {
      const laneId = `lane_${sanitizeId(role.name, '')}_${idx}`;
      laneRoleMap.set(role.name.toLowerCase(), role.name);
      nodes.push({
        id: laneId,
        type: 'lane',
        label: role.name,
        pool: primaryPoolId,
        lane: role.name,
        origin: 'structural',
        data: {
          label: role.name,
          role: role.name,
          origin: 'structural',
        },
      });
    });
  } else {
    // Default lane if no internal roles extracted
    const defaultLaneId = 'lane_staff_0';
    laneRoleMap.set('staff', 'Staff');
    nodes.push({
      id: defaultLaneId,
      type: 'lane',
      label: 'Staff',
      pool: primaryPoolId,
      lane: 'Staff',
      origin: 'structural',
      data: { label: 'Staff', role: 'Staff', origin: 'structural' },
    });
  }

  // 2. Discover ALL external parties (declared in spec + detected from activities and triggers)
  const rawParties = [];
  (spec.participants.external_parties || []).forEach((p) => {
    if (p && p.name && p.name.trim()) {
      rawParties.push(p.name.trim());
    }
  });

  const KNOWN_EXTERNAL_KEYWORDS = [
    'manufacturer', 'retailer', 'supplier', 'vendor', 'customer',
    'client', 'bank', 'credit bureau', 'lab', 'laboratory', 'pharmacy',
    'courier', 'carrier', 'partner'
  ];

  // Scan triggers
  triggers.forEach((t) => {
    const tName = (t.name || '').toLowerCase();
    KNOWN_EXTERNAL_KEYWORDS.forEach((kw) => {
      if (tName.includes(kw) && !laneRoleMap.has(kw)) {
        const cap = kw.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        rawParties.push(cap);
      }
    });
  });

  // Scan activities
  activities.forEach((act) => {
    const aName = (act.name || '').toLowerCase();
    KNOWN_EXTERNAL_KEYWORDS.forEach((kw) => {
      if (aName.includes(kw) && !laneRoleMap.has(kw)) {
        const cap = kw.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        rawParties.push(cap);
      }
    });
  });

  // Deduplicate and canonicalize: sort descending by length so specific names take precedence
  const sortedParties = [...new Set(rawParties)].sort((a, b) => b.length - a.length);
  const canonicalParties = [];
  sortedParties.forEach((p) => {
    const existing = canonicalParties.find((c) => areExternalPoolAliases(c, p));
    if (!existing) {
      canonicalParties.push(p);
    }
  });

  const externalParties = canonicalParties.map((name) => ({ name }));

  // External party pools (MUST be added BEFORE any message flows connect to them)
  const externalPoolIds = new Map();
  externalParties.forEach((party, idx) => {
    const extPoolId = `pool_ext_${sanitizeId(party.name, '')}_${idx}`;
    externalPoolIds.set(party.name.toLowerCase(), extPoolId);
    nodes.push({
      id: extPoolId,
      type: 'pool',
      label: party.name,
      origin: 'stated',
      data: {
        label: party.name,
        isExternal: true,
        origin: 'stated',
      },
    });
  });

  function findMatchingExtPool(text = '') {
    if (externalPoolIds.size === 0) return null;
    const lower = String(text || '').toLowerCase();
    // Prefer most specific matching external pool first
    const entries = Array.from(externalPoolIds.entries()).sort((a, b) => b[0].length - a[0].length);
    for (const [pName, poolId] of entries) {
      if (areExternalPoolAliases(lower, pName) || lower.includes(pName)) {
        return poolId;
      }
    }
    // Fallback to first external pool
    return externalPoolIds.values().next().value || null;
  }

  // 3. Resources mapping
  const roleCostMap = new Map();
  (spec.resources_and_costs || []).forEach((rc) => {
    if (rc.role_or_item) {
      roleCostMap.set(rc.role_or_item.toLowerCase(), rc);
    }
  });

  const rolesToMap = internalRoles.length > 0 ? internalRoles : [{ name: 'Staff', count: 1 }];
  rolesToMap.forEach((role) => {
    const costInfo = roleCostMap.get(role.name.toLowerCase()) || {};
    const statedCount = role.count != null ? role.count : costInfo.quantity;
    const statedSalary = costInfo.salary;

    resources.push({
      id: role.name,
      name: role.name,
      type: 'staff',
      quantity: statedCount != null ? Number(statedCount) : 1,
      quantitySource: statedCount != null ? 'stated' : 'assumed',
      hours_per_day: 8,
      working_days_per_month: 22,
      monthly_salary: statedSalary != null ? Number(statedSalary) : null,
      costSource: statedSalary != null ? 'stated' : 'assumed',
    });
  });

  // Helper to resolve lane name
  function resolveLane(performerRole) {
    if (!performerRole) return internalRoles[0]?.name || 'Staff';
    const match = internalRoles.find((r) => r.name.toLowerCase() === performerRole.toLowerCase());
    if (match) return match.name;
    // External participants must NEVER become swimlanes in the primary business pool
    const isExt = externalParties.some((p) => p.name.toLowerCase() === performerRole.toLowerCase() || areExternalPoolAliases(p.name, performerRole));
    if (isExt) {
      return internalRoles[0]?.name || 'Staff';
    }
    return performerRole;
  }

  // 4. Triggers Partitioning: Exactly ONE start event by default
  const confirmedStarts = new Set(
    (options.confirmedIndependentTriggers || options.confirmedStarts || []).map((s) => String(s).toLowerCase().trim())
  );

  // Identify primary trigger: prefer arrival or message trigger, or first non-condition trigger
  let primaryTrigger = triggers.find((t) => t.type === 'arrival') ||
                       triggers.find((t) => t.type === 'message') ||
                       triggers.find((t) => !t.independent && t.type !== 'condition') ||
                       triggers[0] ||
                       { name: 'Process Start', type: 'arrival', independent: false };

  const secondaryTriggers = triggers.filter((t) => t !== primaryTrigger);

  // Secondary start events are created ONLY if independent is explicitly true AND confirmed by user
  const confirmedSecondaryTriggers = secondaryTriggers.filter(
    (t) => Boolean(t.independent) && (confirmedStarts.has(t.name.toLowerCase().trim()) || (t.id && confirmedStarts.has(String(t.id).toLowerCase().trim())))
  );

  // Unconfirmed secondary triggers are modeled inside the main flow
  const internalSecondaryTriggers = secondaryTriggers.filter((t) => !confirmedSecondaryTriggers.includes(t));

  // Determine start event type helper
  function getStartEventType(trigger) {
    const tType = String(trigger.type || '').toLowerCase();
    if (tType === 'condition') return 'conditional-start-event';
    if (tType === 'schedule' || tType === 'timer') return 'timer-start-event';
    if (tType === 'message' || tType === 'external') return 'message-start-event';
    if (tType === 'arrival') {
      if (/\b(message|order|request|application|inquiry|prescription)s?\b/i.test(trigger.name)) {
        return 'message-start-event';
      }
      return 'start-event';
    }
    if (/schedule|periodic|timer|daily|monthly|every/i.test(trigger.name)) return 'timer-start-event';
    if (/condition|threshold|stock|below/i.test(trigger.name)) return 'conditional-start-event';
    if (/\b(message|order|request|application)s?\b/i.test(trigger.name)) return 'message-start-event';
    return 'start-event';
  }

  // Partition activities between primary flow and confirmed secondary flows
  let primaryActivities = [...activities];
  const secondaryActivitiesMap = new Map();

  if (confirmedSecondaryTriggers.length > 0) {
    confirmedSecondaryTriggers.forEach((trig) => {
      secondaryActivitiesMap.set(trig, []);
    });

    const unassigned = [];
    primaryActivities.forEach((act) => {
      let matchedTrig = null;
      for (const trig of confirmedSecondaryTriggers) {
        const trigWords = trig.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        if (trigWords.some((w) => act.name.toLowerCase().includes(w))) {
          matchedTrig = trig;
          break;
        }
      }
      if (matchedTrig) {
        secondaryActivitiesMap.get(matchedTrig).push(act);
      } else {
        unassigned.push(act);
      }
    });

    primaryActivities = unassigned;
    // Ensure every confirmed secondary trigger has at least 1 activity if possible
    confirmedSecondaryTriggers.forEach((trig) => {
      const acts = secondaryActivitiesMap.get(trig);
      if (acts.length === 0 && primaryActivities.length > 1) {
        acts.push(primaryActivities.pop());
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BUILD PRIMARY FLOW
  // ──────────────────────────────────────────────────────────────────────────
  const primaryStartType = getStartEventType(primaryTrigger);

  // Redundant Wait Step Guard:
  // If the one start is a message start event, it is not followed by a "Wait for ..." step
  if (primaryStartType === 'message-start-event' && primaryActivities.length > 1) {
    if (isRedundantWaitAfterArrival(primaryActivities[0]?.name)) {
      primaryActivities.shift();
    }
  }

  // Lane of the starter role: exactly ONE start event placed in the lane of the role that begins the work
  const starterRole = primaryActivities[0]?.performer_role || internalRoles[0]?.name || 'Staff';
  const primaryStartLane = resolveLane(starterRole);
  const primaryStartId = 'start_primary_flow';

  nodes.push({
    id: primaryStartId,
    type: primaryStartType,
    label: primaryTrigger.name,
    pool: primaryPoolId,
    lane: primaryStartLane,
    origin: 'stated',
    data: {
      label: primaryTrigger.name,
      triggerType: primaryTrigger.type,
      rate: primaryTrigger.rate,
      rate_unit: primaryTrigger.unit,
      interval: primaryTrigger.interval,
      origin: 'stated',
    },
  });

  // If primary start is message start event, connect from external pool
  if (primaryStartType === 'message-start-event') {
    const matchingExtPoolId = findMatchingExtPool(primaryTrigger.name);
    if (matchingExtPoolId) {
      edges.push({
        id: `msg_ext_to_${primaryStartId}`,
        source: matchingExtPoolId,
        target: primaryStartId,
        flowType: 'message',
        type: 'message-flow',
        data: { label: primaryTrigger.name },
      });
    }
  }

  let prevNodeId = primaryStartId;

  const usedDecisions = new Set();
  const DECISION_STOP_WORDS = new Set([
    'order', 'orders', 'check', 'checks', 'level', 'levels', 'place', 'places',
    'process', 'record', 'records', 'store', 'stores', 'item', 'items',
    'receive', 'receives', 'send', 'sends', 'take', 'takes', 'make', 'makes',
    'flow', 'step', 'time', 'work', 'with', 'from', 'that', 'this',
    'have', 'does', 'will', 'should', 'below', 'above', 'need', 'needed',
    'good', 'rate', 'user', 'cost', 'each', 'then', 'after', 'daily',
    'start', 'complete', 'completed', 'ended', 'customer', 'staff'
  ]);

  function createPrimaryActivityNode(act, idx) {
    const actNameLower = (act.name || '').toLowerCase();
    for (const role of internalRoles) {
      if (actNameLower.includes(role.name.toLowerCase())) {
        if (!act.performer_role || act.performer_role === 'Staff' || act.performer_role === internalRoles[0]?.name) {
          act.performer_role = role.name;
        }
        break;
      }
    }

    const actId = `act_primary_${idx}`;
    const actLane = resolveLane(act.performer_role);

    let nodeType = 'task';
    const isExtWait = isWaitingOnExternal(act.name, externalParties);
    if (isExtWait) {
      nodeType = 'message-intermediate-catch';
    } else if (isTimerWait(act.name)) {
      nodeType = 'timer-intermediate-catch';
    }

    const hasStatedDuration = act.duration != null && !isNaN(Number(act.duration));
    const durationVal = hasStatedDuration ? Number(act.duration) : null;
    const durationUnit = hasStatedDuration
      ? (act.duration_unit || 'minutes')
      : (isExtWait || isTimerWait(act.name) ? 'hours' : null);
    const durationSource = hasStatedDuration ? 'stated' : (isExtWait ? 'assumed' : null);

    const taskResources = { [actLane]: 1 };
    if (Array.isArray(act.secondary_roles)) {
      act.secondary_roles.forEach((r) => {
        const cleanR = resolveLane(r);
        taskResources[cleanR] = 1;
      });
    }
    internalRoles.forEach((r) => {
      if (r.name.toLowerCase() !== actLane.toLowerCase() && actNameLower.includes(r.name.toLowerCase())) {
        taskResources[r.name] = 1;
      }
    });

    const taskNode = {
      id: actId,
      type: nodeType,
      label: act.name,
      pool: primaryPoolId,
      lane: actLane,
      origin: 'stated',
      duration: durationVal,
      duration_source: durationSource,
      data: {
        label: act.name,
        duration: durationVal,
        duration_min: durationVal,
        duration_max: durationVal,
        duration_unit: durationUnit,
        duration_source: durationSource,
        estimated: !hasStatedDuration && isExtWait,
        cost: act.cost != null ? Number(act.cost) : null,
        resource: actLane,
        resources: taskResources,
        origin: 'stated',
      },
    };

    nodes.push(taskNode);

    // Message flows to/from external pools
    if (nodeType === 'message-intermediate-catch') {
      const extPoolId = findMatchingExtPool(act.name);
      if (extPoolId) {
        edges.push({
          id: `msg_ext_${extPoolId}_to_${actId}`,
          source: extPoolId,
          target: actId,
          flowType: 'message',
          type: 'message-flow',
          data: { label: act.name },
        });
      }
    } else if (nodeType === 'message-intermediate-throw' || isSendingToExternal(act.name, externalParties)) {
      const extPoolId = findMatchingExtPool(act.name);
      if (extPoolId) {
        edges.push({
          id: `msg_${actId}_to_ext_${extPoolId}`,
          source: actId,
          target: extPoolId,
          flowType: 'message',
          type: 'message-flow',
          data: { label: act.name },
        });
      }
    }

    return { actId, actLane, taskNode };
  }

  // Build primary activities loop
  let actIdx = 0;
  while (actIdx < primaryActivities.length) {
    const act = primaryActivities[actIdx];

    // Check if a decision occurs at or after this activity
    const relevantDecision = decisions.find((d) => {
      if (usedDecisions.has(d)) return false;
      if (d.after_activity && act.name.toLowerCase().includes(d.after_activity.toLowerCase())) {
        return true;
      }
      const qWords = d.question
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !DECISION_STOP_WORDS.has(w));
      return qWords.length > 0 && qWords.some((w) => act.name.toLowerCase().includes(w));
    });

    if (relevantDecision) {
      usedDecisions.add(relevantDecision);
      const isCheckStep = /\b(check|verify|assess|evaluate|review|inspect|test|determine|examine|triage)\b/i.test(act.name);

      if (isCheckStep && actIdx + 1 < primaryActivities.length) {
        const { actId, actLane } = createPrimaryActivityNode(act, actIdx);
        edges.push({
          id: `seq_${prevNodeId}_${actId}`,
          source: prevNodeId,
          target: actId,
          flowType: 'sequence',
          data: {},
        });

        // Collect conditional activities for the affirmative ('Yes') branch
        const branchActs = [];
        let nextIdx = actIdx + 1;
        while (nextIdx < primaryActivities.length) {
          const candidate = primaryActivities[nextIdx];
          const candRole = resolveLane(candidate.performer_role);
          if (candRole !== actLane && branchActs.length >= 1) {
            break;
          }
          branchActs.push({ act: candidate, idx: nextIdx });
          nextIdx++;
          if (nextIdx === primaryActivities.length - 1 && branchActs.length >= 1) {
            break;
          }
        }

        if (branchActs.length > 0) {
          const splitId = `gw_split_primary_${actIdx}`;
          const mergeId = `gw_merge_primary_${actIdx}`;

          nodes.push({
            id: splitId,
            type: 'exclusive-gateway',
            label: relevantDecision.question,
            gateway_role: 'split',
            matching_merge_id: mergeId,
            pool: primaryPoolId,
            lane: actLane,
            origin: 'structural',
            data: {
              label: relevantDecision.question,
              gateway_type: 'exclusive',
              gateway_role: 'split',
              matching_merge_id: mergeId,
              origin: 'structural',
            },
          });

          nodes.push({
            id: mergeId,
            type: 'exclusive-gateway',
            label: '',
            gateway_role: 'merge',
            matching_split_id: splitId,
            pool: primaryPoolId,
            lane: actLane,
            origin: 'structural',
            data: {
              label: '',
              gateway_type: 'exclusive',
              gateway_role: 'merge',
              matching_split_id: splitId,
              origin: 'structural',
            },
          });

          edges.push({
            id: `seq_${actId}_${splitId}`,
            source: actId,
            target: splitId,
            flowType: 'sequence',
            data: {},
          });
          const branches = relevantDecision.branches || [
            { label: 'Yes', probability: undefined },
            { label: 'No', probability: undefined },
          ];
          const yesBranch = branches.find((b) => /^(yes|true|admit|urgent|eligible|proceed)\b/i.test(b.label)) || branches[0] || { label: 'Yes' };
          const noBranch = branches.find((b) => !/^(yes|true|admit|urgent|eligible|proceed)\b/i.test(b.label)) || branches[1] || { label: 'No' };
          const { p1: yesProb, p2: noProb } = resolveTwoBranchProbs(yesBranch, noBranch);

          let branchPrevId = splitId;
          branchActs.forEach((ba, bSubIdx) => {
            const { actId: bActId } = createPrimaryActivityNode(ba.act, ba.idx);
            edges.push({
              id: `seq_${branchPrevId}_${bActId}`,
              source: branchPrevId,
              target: bActId,
              flowType: 'sequence',
              data: bSubIdx === 0 ? {
                label: yesBranch.label || 'Yes',
                probability: yesProb,
              } : {},
            });
            branchPrevId = bActId;
          });

          edges.push({
            id: `seq_${branchPrevId}_${mergeId}`,
            source: branchPrevId,
            target: mergeId,
            flowType: 'sequence',
            data: {},
          });

          edges.push({
            id: `seq_${splitId}_${mergeId}_bypass`,
            source: splitId,
            target: mergeId,
            flowType: 'sequence',
            data: {
              label: noBranch.label || 'No',
              probability: noProb,
            },
          });

          prevNodeId = mergeId;
          actIdx = nextIdx;
          continue;
        } else {
          prevNodeId = actId;
          actIdx++;
          continue;
        }
      } else {
        // act itself is the conditional action! Place inside 'Yes' branch after Split
        const { actId, actLane } = createPrimaryActivityNode(act, actIdx);
        const splitId = `gw_split_primary_${actIdx}`;
        const mergeId = `gw_merge_primary_${actIdx}`;

        nodes.push({
          id: splitId,
          type: 'exclusive-gateway',
          label: relevantDecision.question,
          gateway_role: 'split',
          matching_merge_id: mergeId,
          pool: primaryPoolId,
          lane: actLane,
          origin: 'structural',
          data: {
            label: relevantDecision.question,
            gateway_type: 'exclusive',
            gateway_role: 'split',
            matching_merge_id: mergeId,
            origin: 'structural',
          },
        });

        nodes.push({
          id: mergeId,
          type: 'exclusive-gateway',
          label: '',
          gateway_role: 'merge',
          matching_split_id: splitId,
          pool: primaryPoolId,
          lane: actLane,
          origin: 'structural',
          data: {
            label: '',
            gateway_type: 'exclusive',
            gateway_role: 'merge',
            matching_split_id: splitId,
            origin: 'structural',
          },
        });

        edges.push({
          id: `seq_${prevNodeId}_${splitId}`,
          source: prevNodeId,
          target: splitId,
          flowType: 'sequence',
          data: {},
        });

        const branches = relevantDecision.branches || [
          { label: 'Yes', probability: undefined },
          { label: 'No', probability: undefined },
        ];
        const yesBranch = branches.find((b) => /^(yes|true|admit|urgent|eligible|proceed)\b/i.test(b.label)) || branches[0] || { label: 'Yes' };
        const noBranch = branches.find((b) => !/^(yes|true|admit|urgent|eligible|proceed)\b/i.test(b.label)) || branches[1] || { label: 'No' };
        const { p1: yesProb, p2: noProb } = resolveTwoBranchProbs(yesBranch, noBranch);

        edges.push({
          id: `seq_${splitId}_${actId}`,
          source: splitId,
          target: actId,
          flowType: 'sequence',
          data: {
            label: yesBranch.label || 'Yes',
            probability: yesProb,
          },
        });

        edges.push({
          id: `seq_${actId}_${mergeId}`,
          source: actId,
          target: mergeId,
          flowType: 'sequence',
          data: {},
        });

        edges.push({
          id: `seq_${splitId}_${mergeId}_bypass`,
          source: splitId,
          target: mergeId,
          flowType: 'sequence',
          data: {
            label: noBranch.label || 'No',
            probability: noProb,
          },
        });

        prevNodeId = mergeId;
        actIdx++;
        continue;
      }
    }

    const { actId } = createPrimaryActivityNode(act, actIdx);
    edges.push({
      id: `seq_${prevNodeId}_${actId}`,
      source: prevNodeId,
      target: actId,
      flowType: 'sequence',
      data: {},
    });
    prevNodeId = actId;
    actIdx++;
  }

  // End event for primary flow: named after the outcome of the branch/flow, not generic "Complete"
  const lastPrimaryAct = primaryActivities[primaryActivities.length - 1];
  const primaryEndLane = lastPrimaryAct ? resolveLane(lastPrimaryAct.performer_role) : primaryStartLane;
  const primaryEndId = 'end_primary_flow';
  const primaryEndLabel = deriveOutcomeEndLabel(lastPrimaryAct?.name, 'Process Completed');

  nodes.push({
    id: primaryEndId,
    type: 'end-event',
    label: primaryEndLabel,
    pool: primaryPoolId,
    lane: primaryEndLane,
    origin: 'structural',
    data: {
      label: primaryEndLabel,
      origin: 'structural',
    },
  });

  edges.push({
    id: `seq_${prevNodeId}_${primaryEndId}`,
    source: prevNodeId,
    target: primaryEndId,
    flowType: 'sequence',
    data: {},
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BUILD CONFIRMED SECONDARY INDEPENDENT FLOWS (ONLY IF USER CONFIRMED)
  // ──────────────────────────────────────────────────────────────────────────
  confirmedSecondaryTriggers.forEach((secTrig, sIdx) => {
    const secActs = secondaryActivitiesMap.get(secTrig) || [];
    const secStartType = getStartEventType(secTrig);
    const secStarterRole = secActs[0]?.performer_role || internalRoles[0]?.name || 'Staff';
    const secStartLane = resolveLane(secStarterRole);
    const secStartId = `start_secondary_${sIdx}`;

    nodes.push({
      id: secStartId,
      type: secStartType,
      label: secTrig.name,
      pool: primaryPoolId,
      lane: secStartLane,
      origin: 'stated',
      data: {
        label: secTrig.name,
        triggerType: secTrig.type,
        rate: secTrig.rate,
        rate_unit: secTrig.unit,
        interval: secTrig.interval,
        origin: 'stated',
      },
    });

    if (secStartType === 'message-start-event') {
      const matchingExtPoolId = findMatchingExtPool(secTrig.name);
      if (matchingExtPoolId) {
        edges.push({
          id: `msg_ext_to_${secStartId}`,
          source: matchingExtPoolId,
          target: secStartId,
          flowType: 'message',
          type: 'message-flow',
          data: { label: secTrig.name },
        });
      }
    }

    let secPrevNodeId = secStartId;

    secActs.forEach((act, aIdx) => {
      const actId = `act_secondary_${sIdx}_${aIdx}`;
      const actLane = resolveLane(act.performer_role);

      let nodeType = 'task';
      if (isWaitingOnExternal(act.name, externalParties)) {
        nodeType = 'message-intermediate-catch';
      } else if (isTimerWait(act.name)) {
        nodeType = 'timer-intermediate-catch';
      }

      const hasStatedDuration = act.duration != null && !isNaN(Number(act.duration));
      const durationVal = hasStatedDuration ? Number(act.duration) : null;
      const durationUnit = hasStatedDuration ? (act.duration_unit || 'minutes') : null;
      const durationSource = hasStatedDuration ? 'stated' : null;

      const secTaskResources = { [actLane]: 1 };
      if (Array.isArray(act.secondary_roles)) {
        act.secondary_roles.forEach((r) => {
          const cleanR = resolveLane(r);
          secTaskResources[cleanR] = 1;
        });
      }

      nodes.push({
        id: actId,
        type: nodeType,
        label: act.name,
        pool: primaryPoolId,
        lane: actLane,
        origin: 'stated',
        duration: durationVal,
        duration_source: durationSource,
        data: {
          label: act.name,
          duration: durationVal,
          duration_min: durationVal,
          duration_max: durationVal,
          duration_unit: durationUnit,
          duration_source: durationSource,
          cost: act.cost != null ? Number(act.cost) : null,
          resource: actLane,
          resources: secTaskResources,
          origin: 'stated',
        },
      });

      edges.push({
        id: `seq_${secPrevNodeId}_${actId}`,
        source: secPrevNodeId,
        target: actId,
        flowType: 'sequence',
        data: {},
      });

      // Message flows for secondary activities
      if (nodeType === 'message-intermediate-catch') {
        const extPoolId = findMatchingExtPool(act.name);
        if (extPoolId) {
          edges.push({
            id: `msg_ext_${extPoolId}_to_${actId}`,
            source: extPoolId,
            target: actId,
            flowType: 'message',
            type: 'message-flow',
            data: { label: act.name },
          });
        }
      } else if (nodeType === 'message-intermediate-throw' || isSendingToExternal(act.name, externalParties)) {
        const extPoolId = findMatchingExtPool(act.name);
        if (extPoolId) {
          edges.push({
            id: `msg_${actId}_to_ext_${extPoolId}`,
            source: actId,
            target: extPoolId,
            flowType: 'message',
            type: 'message-flow',
            data: { label: act.name },
          });
        }
      }

      secPrevNodeId = actId;
    });

    const lastSecAct = secActs[secActs.length - 1];
    const secEndLane = lastSecAct ? resolveLane(lastSecAct.performer_role) : secStartLane;
    const secEndId = `end_secondary_${sIdx}`;
    const secEndLabel = deriveOutcomeEndLabel(lastSecAct?.name || secTrig.name, `${secTrig.name} Finished`);

    nodes.push({
      id: secEndId,
      type: 'end-event',
      label: secEndLabel,
      pool: primaryPoolId,
      lane: secEndLane,
      origin: 'structural',
      data: {
        label: secEndLabel,
        origin: 'structural',
      },
    });

    edges.push({
      id: `seq_${secPrevNodeId}_${secEndId}`,
      source: secPrevNodeId,
      target: secEndId,
      flowType: 'sequence',
      data: {},
    });
  });

  // Prune empty swimlanes from nodes so the canvas never displays blank lanes
  const activeLanes = new Set(
    nodes.filter((n) => n.type !== 'lane' && n.type !== 'pool' && n.lane).map((n) => n.lane.toLowerCase())
  );
  let finalNodes = nodes;
  if (activeLanes.size > 0) {
    finalNodes = nodes.filter((n) => {
      if (n.type === 'lane') {
        return activeLanes.has((n.label || '').toLowerCase());
      }
      return true;
    });
  }

  // Ensure all active lane roles are in resources
  const existingResourceNames = new Set(resources.map((r) => r.name.toLowerCase()));
  activeLanes.forEach((laneName) => {
    if (!existingResourceNames.has(laneName)) {
      const matchRole = internalRoles.find((r) => r.name.toLowerCase() === laneName);
      const roleName = matchRole ? matchRole.name : laneName.charAt(0).toUpperCase() + laneName.slice(1);
      resources.push({
        id: roleName,
        name: roleName,
        type: 'staff',
        quantity: 1,
        quantitySource: 'assumed',
        hours_per_day: 8,
        working_days_per_month: 22,
        monthly_salary: null,
        costSource: 'assumed',
      });
      existingResourceNames.add(laneName);
    }
  });

  return {
    type: 'diagram',
    summary: `${spec.goals_or_issues?.[0] || 'Generated process model'} with ${1 + confirmedSecondaryTriggers.length} flow(s) and ${activities.length} activity(ies).`,
    nodes: finalNodes,
    edges,
    resources,
  };
}

export const convertSpecToBpmn = specToBpmn;
