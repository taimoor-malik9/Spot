/**
 * lib/intake/intakeHelpers.js
 *
 * Pure helper functions for Module I3 Intake Screens:
 * - Active task filtering (skips unkept inferred steps)
 * - Screen answered detection (skips screens already answered by rawDiagram)
 * - Available staff role extraction
 * - Pre-filling answers from rawDiagram
 * - Building final answers matching I1 schema
 */

import {
  SPEED_MAPPINGS,
  DEFAULT_SPEED,
  DEFAULT_BUSYNESS,
  DEFAULT_GOAL,
  DEFAULT_HAS_LIMITED_SPACE,
  DEFAULT_SPACE_NAME,
  DEFAULT_SPACE_UNITS,
  wrapValue,
} from './schema.js';

export const COMMON_FALLBACK_ROLES = ['Staff', 'Cashier', 'Barista', 'Manager', 'Technician'];
export const COMMON_SPACE_PRESETS = ['Table', 'Room', 'Seat', 'Desk', 'Booth', 'Bay'];

export function isWaitingOrDeliveryOrStructuralStep(node) {
  if (!node) return false;
  const origin = node.origin || node.data?.origin;
  const isStructural = origin === 'structural' || node.data?.isStructural === true || node.isStructural === true;
  if (isStructural) return true;
  const type = String(node.type || node.data?.type || '').toLowerCase();
  if (type.includes('message') || type.includes('timer') || type.includes('intermediate')) return true;
  const lbl = String(node.data?.label || node.label || '').trim().toLowerCase();
  return /^(wait\s+for|await|waiting\s+for|receive\s+delivery|receive|delivery\s+arrival|arrival)\b/i.test(lbl);
}

/**
 * Filters active task nodes for intake screens.
 * Screens 1 and 2 skip inferred steps that were not Kept.
 */
export function getActiveTaskNodes(rawDiagram) {
  const nodes = Array.isArray(rawDiagram) ? rawDiagram : (rawDiagram?.nodes || []);
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((n) => {
    if (n.type !== 'task' && !n.type?.endsWith('-task')) return false;
    const isInferred = n.origin === 'inferred' || n.data?.origin === 'inferred';
    const isKept = n.kept === true || n.data?.kept === true;
    if (isInferred && !isKept) return false;
    return true;
  });
}

export function getStaffQuestionTaskNodes(rawDiagram) {
  const nodes = getActiveTaskNodes(rawDiagram);
  return nodes.filter((n) => !isWaitingOrDeliveryOrStructuralStep(n));
}

/**
 * Checks if a specific intake screen is already definitively answered by the raw diagram.
 */
export function isScreenAnswered(screenId, rawDiagram, activeNodes = null) {
  const nodes = activeNodes || getActiveTaskNodes(rawDiagram);
  const spec = rawDiagram?.spec;
  const missing = Array.isArray(spec?.missing_or_ambiguous) ? spec.missing_or_ambiguous : [];

  switch (screenId) {
    case 1: {
      // Who handles each step: Answered if all active tasks have stated staff and not missing
      if (missing.some((m) => /staff|role|performer|worker/i.test(m.field || ''))) return false;
      if (!nodes.length) return true;
      if (rawDiagram?.staffAnswered === true || rawDiagram?.staffSource === 'stated') return true;
      const staffList = (rawDiagram?.resources || []).filter((r) => r.type === 'staff');
      return nodes.every((n) => {
        const hasRes =
          (n.data?.resources && Object.keys(n.data.resources).length > 0) ||
          Boolean(n.data?.resource);
        if (!hasRes) return false;
        const resName = n.data?.resource || Object.keys(n.data?.resources || {})[0];
        const resObj = staffList.find((r) => r.name === resName || r.id === resName);
        return resObj?.quantitySource === 'stated' || resObj?.source === 'stated';
      });
    }

    case 2: {
      // Speed per step: Answered if every active task has duration_source === 'stated' and not missing
      if (missing.some((m) => /duration|speed|time/i.test(m.field || ''))) return false;
      if (!nodes.length) return true;
      if (rawDiagram?.speedAnswered === true || rawDiagram?.speedSource === 'stated') return true;
      return nodes.every(
        (n) => (n.data?.duration_source === 'stated' || n.duration_source === 'stated') && n.data?.duration != null
      );
    }

    case 3: {
      // How busy is rush hour: Answered if busyness is explicitly stated in diagram and not missing
      if (missing.some((m) => /arrival|rate|busyness|frequency|interval|trigger/i.test(m.field || ''))) return false;
      return Boolean(
        rawDiagram?.simulationConfig?.busynessSource === 'stated' ||
        rawDiagram?.busynessSource === 'stated' ||
        rawDiagram?.simulationConfig?.busyness_source === 'stated' ||
        rawDiagram?.busynessAnswered === true
      );
    }

    case 4: {
      // Does it ever go wrong: Answered if exceptions are explicitly stated or decisions exist
      if (missing.some((m) => /exception|defect|error|failure/i.test(m.field || ''))) return false;
      if (
        rawDiagram?.exceptionsAnswered === true ||
        rawDiagram?.exceptionsSource === 'stated' ||
        rawDiagram?.exceptions_source === 'stated'
      ) {
        return true;
      }
      if (spec?.decisions && spec.decisions.length > 0) {
        return true;
      }
      return false;
    }

    case 5: {
      // Do customers ever wait for a table/seat/room: Answered if facility resource is stated
      if (missing.some((m) => /space|capacity|table|room|seat|bay/i.test(m.field || ''))) return false;
      if (rawDiagram?.spaceAnswered === true || rawDiagram?.spaceSource === 'stated') return true;
      return Boolean(
        (rawDiagram?.resources || []).some(
          (r) => r.type === 'facility' && (r.quantitySource === 'stated' || r.source === 'stated')
        )
      );
    }

    case 6: {
      // Goal: If stated goals/issues exist, ask the user to confirm/prioritize via Screen 6
      if (rawDiagram?.goalAnswered === true) return true;
      if (spec?.goals_or_issues && spec.goals_or_issues.length > 0) {
        return false;
      }
      return Boolean(
        rawDiagram?.simulationConfig?.goalSource === 'stated' ||
        rawDiagram?.goalSource === 'stated' ||
        rawDiagram?.simulationConfig?.goal_source === 'stated'
      );
    }

    case 7: {
      // Add costs: Answered if all staff resources have costSource === 'stated' and not missing
      if (missing.some((m) => /cost|salary|wage/i.test(m.field || ''))) return false;
      if (rawDiagram?.costsAnswered === true || rawDiagram?.costsSource === 'stated') return true;
      const staffRes = (rawDiagram?.resources || []).filter((r) => r.type === 'staff');
      const hasTaskStaff = nodes.some(
        (n) => (n.data?.resources && Object.keys(n.data.resources).length > 0) || Boolean(n.data?.resource)
      );
      if (!staffRes.length && !hasTaskStaff) return true;
      if (!staffRes.length) return false;
      return staffRes.every((r) => r.costSource === 'stated' || r.cost_source === 'stated');
    }

    default:
      return false;
  }
}

/**
 * Returns available staff roles from diagram resources with sensible fallbacks.
 */
export function getAvailableStaffRoles(rawDiagram) {
  const staff = (rawDiagram?.resources || [])
    .filter((r) => r.type === 'staff' && r.name)
    .map((r) => r.name);
  return Array.from(new Set(staff));
}

/**
 * Initializes answer state pre-filled from rawDiagram.
 */
export function initializeIntakeAnswers(rawDiagram, activeNodes) {
  const nodes = activeNodes || getActiveTaskNodes(rawDiagram);
  const steps = {};

  (rawDiagram?.nodes || []).forEach((n) => {
    if (n.type !== 'task' && !n.type?.endsWith('-task')) return;
    const isInferred = n.origin === 'inferred' || n.data?.origin === 'inferred';
    const isKept = n.kept === true || n.data?.kept === true;

    if (isInferred && !isKept) {
      steps[n.id] = {
        speed: wrapValue(DEFAULT_SPEED, 'default', true),
        staffRoles: wrapValue([], 'default', true),
        kept: false,
      };
      return;
    }

    // Pre-fill speed from duration
    const hasExplicitDur = (n.data?.duration != null && !isNaN(Number(n.data.duration))) ||
      (n.duration != null && !isNaN(Number(n.duration)));
    const isStatedDuration = Boolean(
      (n.data?.duration_source === 'stated' || n.duration_source === 'stated') && hasExplicitDur
    );

    let initialSpeed = null;
    let defaultMin = null;
    let defaultMax = null;
    let defaultDuration = null;
    let durSource = 'unstated';

    if (hasExplicitDur && n.data?.duration_source !== 'assumed') {
      const d = Number(n.data?.duration ?? n.duration);
      if (d <= 2) initialSpeed = 'quick';
      else if (d >= 10) initialSpeed = 'slow';
      else initialSpeed = 'normal';

      defaultMin = n.data?.duration_min != null ? Number(n.data.duration_min) : (isStatedDuration ? d : SPEED_MAPPINGS[initialSpeed].duration_min);
      defaultMax = n.data?.duration_max != null ? Number(n.data.duration_max) : (isStatedDuration ? d : SPEED_MAPPINGS[initialSpeed].duration_max);
      defaultDuration = isStatedDuration ? d : (defaultMin === defaultMax ? defaultMin : Math.round((defaultMin + defaultMax) / 2));
      durSource = isStatedDuration ? 'bucket' : 'estimated';
    }

    // Pre-fill staff roles
    const existingRoles = [];
    if (n.data?.resources && typeof n.data.resources === 'object') {
      existingRoles.push(...Object.keys(n.data.resources));
    } else if (n.data?.resource) {
      existingRoles.push(n.data.resource);
    }

    const defaultUnit = n.data?.duration_unit || (initialSpeed ? SPEED_MAPPINGS[initialSpeed]?.duration_unit : 'minutes') || 'minutes';

    steps[n.id] = {
      speed: wrapValue(initialSpeed, isStatedDuration ? 'tap' : 'default', !isStatedDuration),
      duration_min: defaultMin,
      duration_max: defaultMax,
      duration: defaultDuration,
      duration_unit: defaultUnit,
      source: durSource,
      staffRoles: wrapValue(existingRoles, existingRoles.length > 0 ? 'tap' : 'default', existingRoles.length === 0),
      kept: isKept || !isInferred,
    };
  });

  // Pre-fill busyness
  const isBusynessStated = rawDiagram?.simulationConfig?.busynessSource === 'stated' || rawDiagram?.busynessSource === 'stated';
  const initialBusyness =
    rawDiagram?.simulationConfig?.busyness || rawDiagram?.busyness || DEFAULT_BUSYNESS;

  // Pre-fill exceptions from diagram edge labels if available
  const detectedExceptions = [];
  (rawDiagram?.edges || []).forEach((e) => {
    const lbl = String(e.data?.label || e.label || '').toLowerCase();
    if (lbl.includes('stock') || lbl.includes('unavailable')) detectedExceptions.push('Out of stock');
    if (lbl.includes('refund') || lbl.includes('return')) detectedExceptions.push('Refund');
    if (lbl.includes('leave') || lbl.includes('cancel') || lbl.includes('walkout')) detectedExceptions.push('Customer leaves');
  });

  // Pre-fill space
  const fac = (rawDiagram?.resources || []).find((r) => r.type === 'facility');
  const hasSpace = Boolean(fac);
  const spaceName = fac?.name || DEFAULT_SPACE_NAME;
  const spaceUnits = Number(fac?.quantity) || DEFAULT_SPACE_UNITS;

  // Pre-fill goal
  let initialGoal = DEFAULT_GOAL;
  let isGoalStated = false;
  if (rawDiagram?.spec?.goals_or_issues?.length > 0) {
    const goalsText = rawDiagram.spec.goals_or_issues.join(' ').toLowerCase();
    if (/wait|delay|time|slow|speed|queue/i.test(goalsText)) {
      initialGoal = 'waiting';
      isGoalStated = true;
    } else if (/cost|expense|salary|budget|saving/i.test(goalsText)) {
      initialGoal = 'cost';
      isGoalStated = true;
    } else if (/throughput|volume|order|deliver|capacity/i.test(goalsText)) {
      initialGoal = 'throughput';
      isGoalStated = true;
    } else if (/utiliz|idle|efficiency/i.test(goalsText)) {
      initialGoal = 'utilization';
      isGoalStated = true;
    }
  }

  // Pre-fill costs
  const costs = {};
  let anyCostStated = false;
  (rawDiagram?.resources || []).forEach((r) => {
    if (r.type === 'staff') {
      if ((r.costSource === 'stated' || r.cost_source === 'stated') && r.monthly_salary != null) {
        costs[r.name] = Number(r.monthly_salary);
        anyCostStated = true;
      } else {
        costs[r.name] = Number(r.monthly_salary) || 50000;
      }
    }
  });

  return {
    steps,
    busyness: wrapValue(initialBusyness, isBusynessStated ? 'tap' : 'default', !isBusynessStated),
    exceptions: wrapValue(
      detectedExceptions.length ? Array.from(new Set(detectedExceptions)) : [],
      detectedExceptions.length > 0 ? 'tap' : 'default',
      detectedExceptions.length === 0
    ),
    hasLimitedSpace: wrapValue(hasSpace, hasSpace ? 'tap' : 'default', !hasSpace),
    spaceName: wrapValue(spaceName, hasSpace ? 'tap' : 'default', !hasSpace),
    spaceUnits: wrapValue(spaceUnits, hasSpace ? 'tap' : 'default', !hasSpace),
    spaceStepId: wrapValue(nodes[0]?.id || null, 'default', true),
    goal: wrapValue(initialGoal, isGoalStated ? 'tap' : 'default', !isGoalStated),
    costs: wrapValue(costs, anyCostStated ? 'tap' : 'default', !anyCostStated),
  };
}

/**
 * Builds the final answers payload conforming to the I1 schema.
 */
export function buildFinalAnswers(rawDiagram, answersState, activeNodes) {
  const allNodes = rawDiagram?.nodes || [];
  const finalSteps = {};

  allNodes.forEach((n) => {
    if (n.type !== 'task' && !n.type?.endsWith('-task')) return;
    const isInferred = n.origin === 'inferred' || n.data?.origin === 'inferred';
    const isKept = n.kept === true || n.data?.kept === true;

    if (isInferred && !isKept) {
      finalSteps[n.id] = {
        speed: wrapValue(DEFAULT_SPEED, 'default', true),
        staffRoles: wrapValue([], 'default', true),
        kept: false,
      };
      return;
    }

    const currentStep = answersState.steps?.[n.id];
    const speedVal = currentStep?.speed?.value || DEFAULT_SPEED;
    const isEstimated = Boolean(currentStep?.speed?.estimated || currentStep?.source === 'estimated');
    const isCustom = speedVal === 'custom' || currentStep?.source === 'custom';

    let min = currentStep?.duration_min;
    let max = currentStep?.duration_max;
    let unit = currentStep?.duration_unit || 'minutes';

    if (min == null || max == null) {
      const bucket = SPEED_MAPPINGS[speedVal] || SPEED_MAPPINGS[DEFAULT_SPEED];
      min = bucket.duration_min;
      max = bucket.duration_max;
      unit = bucket.duration_unit;
    }

    const numMin = Number(min);
    const numMax = Number(max);
    let duration;
    if (isCustom) {
      duration = numMin === numMax ? numMin : (currentStep?.duration != null ? Number(currentStep.duration) : Math.round((numMin + numMax) / 2));
    } else {
      const bucket = SPEED_MAPPINGS[speedVal] || SPEED_MAPPINGS[DEFAULT_SPEED];
      duration = bucket.duration;
    }
    const source = isEstimated ? 'estimated' : (isCustom ? 'custom' : 'bucket');

    finalSteps[n.id] = {
      speed: currentStep?.speed || wrapValue(DEFAULT_SPEED, 'default', true),
      duration_min: numMin,
      duration_max: numMax,
      duration,
      duration_unit: unit,
      source,
      staffRoles: currentStep?.staffRoles || wrapValue([], 'default', true),
      kept: true,
    };
  });

  return {
    steps: finalSteps,
    busyness: answersState.busyness !== undefined ? answersState.busyness : wrapValue(DEFAULT_BUSYNESS, 'default', true),
    exceptions: answersState.exceptions !== undefined ? answersState.exceptions : wrapValue([], 'default', true),
    hasLimitedSpace: answersState.hasLimitedSpace !== undefined ? answersState.hasLimitedSpace : wrapValue(DEFAULT_HAS_LIMITED_SPACE, 'default', true),
    spaceName: answersState.spaceName !== undefined ? answersState.spaceName : wrapValue(DEFAULT_SPACE_NAME, 'default', true),
    spaceUnits: answersState.spaceUnits !== undefined ? answersState.spaceUnits : wrapValue(DEFAULT_SPACE_UNITS, 'default', true),
    spaceStepId: answersState.spaceStepId !== undefined ? answersState.spaceStepId : wrapValue(activeNodes?.[0]?.id || null, 'default', true),
    goal: answersState.goal !== undefined ? answersState.goal : wrapValue(DEFAULT_GOAL, 'default', true),
    costs: answersState.costs !== undefined ? answersState.costs : wrapValue({}, 'default', true),
  };
}
