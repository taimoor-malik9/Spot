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

/**
 * Filters active task nodes for intake screens.
 * Screens 1 and 2 skip inferred steps that were not Kept.
 */
export function getActiveTaskNodes(rawDiagram) {
  if (!rawDiagram?.nodes || !Array.isArray(rawDiagram.nodes)) return [];
  return rawDiagram.nodes.filter((n) => {
    if (n.type !== 'task' && !n.type?.endsWith('-task')) return false;
    const isInferred = n.origin === 'inferred' || n.data?.origin === 'inferred';
    const isKept = n.kept === true || n.data?.kept === true;
    if (isInferred && !isKept) return false;
    return true;
  });
}

/**
 * Checks if a specific intake screen is already definitively answered by the raw diagram.
 */
export function isScreenAnswered(screenId, rawDiagram, activeNodes = null) {
  const nodes = activeNodes || getActiveTaskNodes(rawDiagram);

  switch (screenId) {
    case 1: {
      // Who handles each step: Answered if all active tasks have stated staff
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
      // Speed per step: Answered if every active task has duration_source === 'stated'
      if (!nodes.length) return true;
      if (rawDiagram?.speedAnswered === true || rawDiagram?.speedSource === 'stated') return true;
      return nodes.every(
        (n) => (n.data?.duration_source === 'stated' || n.duration_source === 'stated') && n.data?.duration != null
      );
    }

    case 3: {
      // How busy is rush hour: Answered if busyness is explicitly stated in diagram
      return Boolean(
        rawDiagram?.simulationConfig?.busynessSource === 'stated' ||
        rawDiagram?.busynessSource === 'stated' ||
        rawDiagram?.simulationConfig?.busyness_source === 'stated' ||
        rawDiagram?.busynessAnswered === true
      );
    }

    case 4: {
      // Does it ever go wrong: Answered if exceptions are explicitly stated
      return Boolean(
        rawDiagram?.exceptionsAnswered === true ||
        rawDiagram?.exceptionsSource === 'stated' ||
        rawDiagram?.exceptions_source === 'stated'
      );
    }

    case 5: {
      // Do customers ever wait for a table/seat/room: Answered if facility resource is stated
      if (rawDiagram?.spaceAnswered === true || rawDiagram?.spaceSource === 'stated') return true;
      return Boolean(
        (rawDiagram?.resources || []).some(
          (r) => r.type === 'facility' && (r.quantitySource === 'stated' || r.source === 'stated')
        )
      );
    }

    case 6: {
      // Goal: Answered if optimization goal is stated
      return Boolean(
        rawDiagram?.simulationConfig?.goalSource === 'stated' ||
        rawDiagram?.goalSource === 'stated' ||
        rawDiagram?.simulationConfig?.goal_source === 'stated' ||
        rawDiagram?.goalAnswered === true
      );
    }

    case 7: {
      // Add costs: Answered if all staff resources have costSource === 'stated'
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
    const d = Number(n.data?.duration) || 5;
    let initialSpeed = 'normal';
    if (d <= 2) initialSpeed = 'quick';
    else if (d >= 10) initialSpeed = 'slow';

    const isStatedDuration = n.data?.duration_source === 'stated' || n.duration_source === 'stated';

    // Pre-fill staff roles
    const existingRoles = [];
    if (n.data?.resources && typeof n.data.resources === 'object') {
      existingRoles.push(...Object.keys(n.data.resources));
    } else if (n.data?.resource) {
      existingRoles.push(n.data.resource);
    }

    steps[n.id] = {
      speed: wrapValue(initialSpeed, isStatedDuration ? 'tap' : 'default', !isStatedDuration),
      staffRoles: wrapValue(existingRoles, existingRoles.length > 0 ? 'tap' : 'default', existingRoles.length === 0),
      kept: isKept || !isInferred,
    };
  });

  // Pre-fill busyness
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

  // Pre-fill costs
  const costs = {};
  (rawDiagram?.resources || []).forEach((r) => {
    if (r.type === 'staff') {
      costs[r.name] = Number(r.monthly_salary) || 50000;
    }
  });

  return {
    steps,
    busyness: wrapValue(initialBusyness, 'default', true),
    exceptions: wrapValue(
      detectedExceptions.length ? Array.from(new Set(detectedExceptions)) : [],
      'default',
      detectedExceptions.length === 0
    ),
    hasLimitedSpace: wrapValue(hasSpace, 'default', !hasSpace),
    spaceName: wrapValue(spaceName, 'default', !hasSpace),
    spaceUnits: wrapValue(spaceUnits, 'default', !hasSpace),
    spaceStepId: wrapValue(nodes[0]?.id || null, 'default', true),
    goal: wrapValue(DEFAULT_GOAL, 'default', true),
    costs: wrapValue(costs, 'default', true),
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
    finalSteps[n.id] = {
      speed: currentStep?.speed || wrapValue(DEFAULT_SPEED, 'default', true),
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
