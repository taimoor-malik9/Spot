/**
 * lib/intake/applyIntake.js
 *
 * Pure function that applies guided intake answers onto a raw BPMN diagram.
 *
 * Rules:
 *  - Pure, never mutates rawDiagram or answers.
 *  - Enforces BPMN rules.
 *  - Never applies speed or staff to nodes with origin: "inferred" unless marked kept: true.
 *    Any unkept inferred node adds no delay (duration 0, no resources).
 *  - Adds a facility/space resource ONLY when hasLimitedSpace is true, attached to the chosen step.
 *  - Missing/unsure values use defaults and are recorded in assumptions with estimated: true.
 *  - Always adds the assumption "Crowding is not modeled".
 *  - Returns { patched, simulationConfig, assumptions }.
 */

import {
  SPEED_MAPPINGS,
  DEFAULT_SPEED,
  BUSYNESS_MAPPINGS,
  DEFAULT_BUSYNESS,
  VALID_GOALS,
  DEFAULT_GOAL,
  DEFAULT_HAS_LIMITED_SPACE,
  DEFAULT_SPACE_NAME,
  DEFAULT_SPACE_UNITS,
  unwrapValue,
  Assumption,
} from './schema.js';

function isTaskLikeNode(node) {
  if (!node || !node.type) return false;
  if (node.type === 'pool' || node.type === 'lane') return false;
  if (node.type.includes('event') || node.type.includes('gateway')) return false;
  return true;
}

function isInferredNode(node) {
  return node?.origin === 'inferred' || node?.data?.origin === 'inferred';
}

function isKeptNode(node, stepAnswer) {
  if (node?.kept === true || node?.data?.kept === true) return true;
  if (stepAnswer?.kept === true) return true;
  if (stepAnswer?.kept && typeof stepAnswer.kept === 'object' && stepAnswer.kept.value === true) return true;
  return false;
}

/**
 * Applies intake answers to a raw BPMN diagram.
 *
 * @param {object} rawDiagram - raw diagram from aiService/generator
 * @param {object} answers - intake answer payload
 * @returns {{ patched: object, simulationConfig: object, assumptions: Assumption[] }}
 */
export function applyIntakeToRawDiagram(rawDiagram, answers = {}) {
  // Pure: deep copy input to avoid mutating rawDiagram
  const patched = JSON.parse(JSON.stringify(rawDiagram || { nodes: [], edges: [], resources: [] }));
  patched.nodes = Array.isArray(patched.nodes) ? patched.nodes : [];
  patched.edges = Array.isArray(patched.edges) ? patched.edges : [];
  patched.resources = Array.isArray(patched.resources) ? patched.resources : [];

  const assumptions = [];

  // Core rule: Always add the structural assumption "Crowding is not modeled"
  assumptions.push(new Assumption('Crowding is not modeled', {
    field: 'crowding',
    estimated: false,
  }));

  // 1. Busyness -> simulationConfig & arrival rate
  const busynessEntry = unwrapValue(answers?.busyness, DEFAULT_BUSYNESS);
  let busynessVal = busynessEntry.value;
  if (!BUSYNESS_MAPPINGS[busynessVal]) {
    busynessVal = DEFAULT_BUSYNESS;
    busynessEntry.estimated = true;
  }

  if (busynessEntry.estimated) {
    assumptions.push(new Assumption(
      `Busyness level is estimated as ${busynessVal} (${BUSYNESS_MAPPINGS[busynessVal].customers_per_hour} customers/hour)`,
      { field: 'busyness', estimated: true, value: busynessVal }
    ));
  }

  const busynessData = BUSYNESS_MAPPINGS[busynessVal];

  // 2. Goal
  const goalEntry = unwrapValue(answers?.goal, DEFAULT_GOAL);
  let goalVal = goalEntry.value;
  if (!VALID_GOALS.includes(goalVal)) {
    goalVal = DEFAULT_GOAL;
    goalEntry.estimated = true;
  }

  if (goalEntry.estimated) {
    assumptions.push(new Assumption(
      `Optimization goal is estimated as minimizing ${goalVal}`,
      { field: 'goal', estimated: true, value: goalVal }
    ));
  }

  const simulationConfig = {
    arrival_rate: busynessData.arrival_rate,
    arrival_gap_minutes: busynessData.arrival_gap_minutes,
    customers_per_hour: busynessData.customers_per_hour,
    busyness: busynessVal,
    goal: goalVal,
    mode: 'deep',
    total_instances: 500,
  };

  // 3. Process Steps (Durations and Staff)
  patched.nodes.forEach((node) => {
    if (!isTaskLikeNode(node)) return;

    node.data = node.data || {};
    node.data.resources = node.data.resources || {};
    const stepAnswer = answers?.steps?.[node.id];
    const inferred = isInferredNode(node);
    const kept = isKeptNode(node, stepAnswer);

    // Core rule (2): AI-added steps that owner did not state add NO delay
    // (duration 0, no resources) until the owner confirms it (kept: true).
    if (inferred && !kept) {
      node.data.duration = 0;
      node.data.duration_min = 0;
      node.data.duration_max = 0;
      node.data.duration_unit = 'minutes';
      node.data.duration_source = 'assumed';
      node.data.resource = null;
      node.data.resources = {};
      return;
    }

    // Apply speed mapping
    const speedEntry = unwrapValue(stepAnswer?.speed, DEFAULT_SPEED);
    let speedVal = speedEntry.value;
    if (!SPEED_MAPPINGS[speedVal]) {
      speedVal = DEFAULT_SPEED;
      speedEntry.estimated = true;
    }

    const speedMap = SPEED_MAPPINGS[speedVal];
    node.data.duration_min = speedMap.duration_min;
    node.data.duration = speedMap.duration;
    node.data.duration_max = speedMap.duration_max;
    node.data.duration_unit = speedMap.duration_unit;
    node.data.duration_source = speedEntry.estimated ? 'assumed' : 'stated';

    if (speedEntry.estimated) {
      const stepLabel = node.data.label || node.label || node.id;
      assumptions.push(new Assumption(
        `Duration for step "${stepLabel}" is estimated as ${speedVal} (${speedMap.duration_min}-${speedMap.duration_max} min, avg ${speedMap.duration} min)`,
        { field: `steps.${node.id}.speed`, nodeId: node.id, estimated: true, value: speedVal }
      ));
    }

    // Apply staff roles
    let staffRoles = stepAnswer?.staffRoles;
    if (staffRoles && typeof staffRoles === 'object' && !Array.isArray(staffRoles) && 'value' in staffRoles) {
      staffRoles = staffRoles.value;
    }

    if (Array.isArray(staffRoles) && staffRoles.length > 0) {
      const taskRes = {};
      staffRoles.forEach((roleName) => {
        if (typeof roleName === 'string' && roleName.trim()) {
          const cleanRole = roleName.trim();
          taskRes[cleanRole] = 1;

          // Ensure role exists in patched.resources
          let res = patched.resources.find((r) => r.name === cleanRole || r.id === cleanRole);
          if (!res) {
            res = {
              id: cleanRole,
              name: cleanRole,
              displayName: cleanRole,
              type: 'staff',
              quantity: 1,
              quantitySource: 'stated',
              costSource: 'assumed',
              hours_per_day: 8,
              working_days_per_month: 22,
              monthly_salary: (answers?.costs && answers.costs[cleanRole] != null)
                ? Number(answers.costs[cleanRole])
                : 50000,
              purchase_price: null,
              lifespan_months: null,
              monthly_running_cost: null,
              monthly_rent: null,
            };
            patched.resources.push(res);
          }
        }
      });

      if (Object.keys(taskRes).length > 0) {
        node.data.resources = taskRes;
        node.data.resource = Object.keys(taskRes)[0];
      }
    }
  });

  // 4. Update Salaries/Costs
  const costsEntry = unwrapValue(answers?.costs, {});
  let costsMap = costsEntry.value;
  if (costsMap && typeof costsMap === 'object' && 'value' in costsMap && typeof costsMap.value === 'object') {
    costsMap = costsMap.value;
  }
  if (costsMap && typeof costsMap === 'object') {
    Object.entries(costsMap).forEach(([role, salary]) => {
      if (salary != null && !isNaN(Number(salary))) {
        const numSalary = Number(salary);
        const res = patched.resources.find((r) => r.name === role || r.id === role);
        if (res) {
          res.monthly_salary = numSalary;
          res.costSource = costsEntry.estimated ? 'assumed' : 'stated';
        }
      }
    });
  }

  const anyStaffEstimatedSalary = patched.resources.some(
    (r) => r.type === 'staff' && (r.costSource === 'assumed' || costsEntry.estimated)
  );
  if (anyStaffEstimatedSalary) {
    assumptions.push(
      new Assumption(
        'Staff salaries are estimated based on benchmark compensation',
        { field: 'costs', estimated: true, value: costsMap }
      )
    );
  }

  // 5. Limited Space Constraint
  const spaceEntry = unwrapValue(answers?.hasLimitedSpace, DEFAULT_HAS_LIMITED_SPACE);

  if (
    answers?.hasLimitedSpace === undefined ||
    answers?.hasLimitedSpace === null ||
    answers?.hasLimitedSpace === 'unsure' ||
    spaceEntry.estimated
  ) {
    if (
      answers?.hasLimitedSpace === undefined ||
      answers?.hasLimitedSpace === null ||
      answers?.hasLimitedSpace === 'unsure'
    ) {
      assumptions.push(new Assumption(
        'Physical space limit was not specified, assumed unlimited capacity',
        { field: 'hasLimitedSpace', estimated: true, value: false }
      ));
    }
  }

  if (spaceEntry.value === true) {
    // Add a space resource ONLY when hasLimitedSpace is true
    const nameEntry = unwrapValue(answers?.spaceName, DEFAULT_SPACE_NAME);
    const unitsEntry = unwrapValue(answers?.spaceUnits, DEFAULT_SPACE_UNITS);

    const spaceName = String(nameEntry.value || DEFAULT_SPACE_NAME).trim();
    const spaceUnits = Math.max(1, parseInt(unitsEntry.value, 10) || DEFAULT_SPACE_UNITS);

    if (nameEntry.estimated) {
      assumptions.push(new Assumption(
        `Limited space name estimated as "${spaceName}"`,
        { field: 'spaceName', estimated: true, value: spaceName }
      ));
    }

    if (unitsEntry.estimated) {
      assumptions.push(new Assumption(
        `Limited space capacity estimated as ${spaceUnits} unit${spaceUnits > 1 ? 's' : ''}`,
        { field: 'spaceUnits', estimated: true, value: spaceUnits }
      ));
    }

    let spaceRes = patched.resources.find((r) => r.name === spaceName && r.type === 'facility');
    if (!spaceRes) {
      spaceRes = {
        id: spaceName,
        name: spaceName,
        displayName: spaceName,
        type: 'facility',
        quantity: spaceUnits,
        quantitySource: unitsEntry.estimated ? 'assumed' : 'stated',
        costSource: 'assumed',
        hours_per_day: null,
        working_days_per_month: null,
        monthly_salary: null,
        purchase_price: null,
        lifespan_months: null,
        monthly_running_cost: null,
        monthly_rent: null,
      };
      patched.resources.push(spaceRes);
    } else {
      spaceRes.quantity = spaceUnits;
      spaceRes.quantitySource = unitsEntry.estimated ? 'assumed' : 'stated';
    }

    // Attach to the chosen step
    const chosenStepId = answers?.spaceStepId || answers?.spaceStep || answers?.spaceNodeId;
    let targetStep = null;
    if (chosenStepId) {
      targetStep = patched.nodes.find((n) => n.id === chosenStepId);
    }

    if (!targetStep) {
      const stepWithSpace = Object.entries(answers?.steps || {}).find(
        ([, s]) => s?.hasSpace || s?.isSpaceStep
      );
      if (stepWithSpace) {
        targetStep = patched.nodes.find((n) => n.id === stepWithSpace[0]);
      }
    }

    if (!targetStep) {
      // Fallback: first active task node
      targetStep = patched.nodes.find((n) => {
        const isTask = isTaskLikeNode(n);
        const inferred = isInferredNode(n);
        const kept = isKeptNode(n, answers?.steps?.[n.id]);
        return isTask && (!inferred || kept);
      });

      if (targetStep) {
        assumptions.push(new Assumption(
          `Limited space "${spaceName}" attached to step "${targetStep.data?.label || targetStep.id}" by default`,
          { field: 'spaceStepId', estimated: true, value: targetStep.id, nodeId: targetStep.id }
        ));
      }
    }

    if (targetStep) {
      targetStep.data = targetStep.data || {};
      targetStep.data.resources = {
        ...(targetStep.data.resources || {}),
        [spaceName]: 1,
      };
      if (!targetStep.data.resource) {
        targetStep.data.resource = spaceName;
      }
    }
  }

  return {
    patched,
    simulationConfig,
    assumptions,
  };
}
