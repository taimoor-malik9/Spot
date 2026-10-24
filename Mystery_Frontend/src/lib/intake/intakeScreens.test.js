/**
 * lib/intake/intakeScreens.test.js
 *
 * Unit tests for Module I3 Intake Screens logic:
 * - Active task filtering (skipping unkept inferred steps)
 * - Screen answered detection and skipping
 * - Available staff role extraction
 * - Intake answers pre-filling from rawDiagram
 * - Building final answers matching I1 schema
 * - Pure integration with applyIntakeToRawDiagram
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getActiveTaskNodes,
  isScreenAnswered,
  getAvailableStaffRoles,
  initializeIntakeAnswers,
  buildFinalAnswers,
} from './intakeHelpers.js';
import { applyIntakeToRawDiagram } from './applyIntake.js';
import { wrapValue, DEFAULT_SPEED, DEFAULT_BUSYNESS, DEFAULT_GOAL } from './schema.js';

describe('Module I3: Active Task Nodes & Inferred Steps', () => {
  it('filters out non-task nodes and keeps stated tasks', () => {
    const raw = {
      nodes: [
        { id: 'start_1', type: 'start-event', origin: 'stated' },
        { id: 'task_1', type: 'task', origin: 'stated', data: { label: 'Order' } },
        { id: 'gw_1', type: 'exclusive-gateway', origin: 'stated' },
        { id: 'task_2', type: 'service-task', origin: 'stated', data: { label: 'Brew' } },
        { id: 'end_1', type: 'end-event', origin: 'stated' },
      ],
    };

    const active = getActiveTaskNodes(raw);
    assert.equal(active.length, 2);
    assert.deepEqual(active.map((n) => n.id), ['task_1', 'task_2']);
  });

  it('skips inferred steps that were not Kept on Screens 1 and 2', () => {
    const raw = {
      nodes: [
        { id: 'task_stated', type: 'task', origin: 'stated' },
        { id: 'task_inferred_unkept', type: 'task', origin: 'inferred', kept: false },
        { id: 'task_inferred_kept', type: 'task', origin: 'inferred', kept: true },
        { id: 'task_inferred_data_kept', type: 'task', data: { origin: 'inferred', kept: true } },
        { id: 'task_inferred_data_unkept', type: 'task', data: { origin: 'inferred', kept: false } },
      ],
    };

    const active = getActiveTaskNodes(raw);
    assert.equal(active.length, 3);
    assert.deepEqual(active.map((n) => n.id), [
      'task_stated',
      'task_inferred_kept',
      'task_inferred_data_kept',
    ]);
  });
});

describe('Module I3: Screen Answered Detection (Skipping Screens)', () => {
  it('Screen 1 (Staff): returns false when tasks have unstated staff, true when all stated', () => {
    const diagWithUnstatedStaff = {
      nodes: [{ id: 't1', type: 'task', data: { resource: 'Barista' } }],
      resources: [{ name: 'Barista', type: 'staff', quantitySource: 'inferred' }],
    };
    assert.equal(isScreenAnswered(1, diagWithUnstatedStaff), false);

    const diagWithStatedStaff = {
      nodes: [{ id: 't1', type: 'task', data: { resource: 'Barista' } }],
      resources: [{ name: 'Barista', type: 'staff', quantitySource: 'stated' }],
    };
    assert.equal(isScreenAnswered(1, diagWithStatedStaff), true);

    const diagWithStaffAnsweredFlag = {
      nodes: [{ id: 't1', type: 'task' }],
      staffAnswered: true,
    };
    assert.equal(isScreenAnswered(1, diagWithStaffAnsweredFlag), true);
  });

  it('Screen 2 (Speed): returns false when duration is unstated, true when all stated', () => {
    const diagUnstatedSpeed = {
      nodes: [{ id: 't1', type: 'task', data: { duration: 5, duration_source: 'assumed' } }],
    };
    assert.equal(isScreenAnswered(2, diagUnstatedSpeed), false);

    const diagStatedSpeed = {
      nodes: [{ id: 't1', type: 'task', data: { duration: 5, duration_source: 'stated' } }],
    };
    assert.equal(isScreenAnswered(2, diagStatedSpeed), true);

    const diagWithSpeedAnsweredFlag = {
      nodes: [{ id: 't1', type: 'task' }],
      speedAnswered: true,
    };
    assert.equal(isScreenAnswered(2, diagWithSpeedAnsweredFlag), true);
  });

  it('Screen 3 (Rush hour): returns true only when busyness is explicitly stated', () => {
    assert.equal(isScreenAnswered(3, { busyness: 'steady' }), false);
    assert.equal(isScreenAnswered(3, { busynessSource: 'stated' }), true);
    assert.equal(isScreenAnswered(3, { simulationConfig: { busynessSource: 'stated' } }), true);
    assert.equal(isScreenAnswered(3, { busynessAnswered: true }), true);
  });

  it('Screen 4 (Exceptions): returns true only when exceptions are explicitly stated', () => {
    assert.equal(isScreenAnswered(4, {}), false);
    assert.equal(isScreenAnswered(4, { exceptionsSource: 'stated' }), true);
    assert.equal(isScreenAnswered(4, { exceptionsAnswered: true }), true);
  });

  it('Screen 5 (Space): returns true when facility resource has stated source', () => {
    assert.equal(isScreenAnswered(5, {}), false);
    assert.equal(
      isScreenAnswered(5, {
        resources: [{ type: 'facility', name: 'Table', quantitySource: 'inferred' }],
      }),
      false
    );
    assert.equal(
      isScreenAnswered(5, {
        resources: [{ type: 'facility', name: 'Table', quantitySource: 'stated' }],
      }),
      true
    );
    assert.equal(isScreenAnswered(5, { spaceAnswered: true }), true);
  });

  it('Screen 6 (Goal): returns true when optimization goal is explicitly stated', () => {
    assert.equal(isScreenAnswered(6, {}), false);
    assert.equal(isScreenAnswered(6, { goalSource: 'stated' }), true);
    assert.equal(isScreenAnswered(6, { simulationConfig: { goal_source: 'stated' } }), true);
    assert.equal(isScreenAnswered(6, { goalAnswered: true }), true);
  });

  it('Screen 7 (Costs): returns true when all staff have stated costs or when no staff exist', () => {
    assert.equal(isScreenAnswered(7, { nodes: [], resources: [] }), true);

    const withUnstatedSalary = {
      nodes: [{ id: 't1', type: 'task', data: { resource: 'Cashier' } }],
      resources: [{ type: 'staff', name: 'Cashier', costSource: 'default' }],
    };
    assert.equal(isScreenAnswered(7, withUnstatedSalary), false);

    const withStatedSalary = {
      nodes: [{ id: 't1', type: 'task', data: { resource: 'Cashier' } }],
      resources: [{ type: 'staff', name: 'Cashier', costSource: 'stated' }],
    };
    assert.equal(isScreenAnswered(7, withStatedSalary), true);
  });
});

describe('Module I3: Staff Extraction & Pre-filling', () => {
  it('extracts unique staff names from diagram resources', () => {
    const raw = {
      resources: [
        { type: 'staff', name: 'Barista' },
        { type: 'staff', name: 'Cashier' },
        { type: 'facility', name: 'Table' },
        { type: 'staff', name: 'Barista' },
      ],
    };
    const roles = getAvailableStaffRoles(raw);
    assert.deepEqual(roles, ['Barista', 'Cashier']);
  });

  it('pre-fills speeds correctly from duration bounds', () => {
    const raw = {
      nodes: [
        { id: 't_quick', type: 'task', data: { duration: 1, duration_source: 'stated' } },
        { id: 't_normal', type: 'task', data: { duration: 5 } },
        { id: 't_slow', type: 'task', data: { duration: 15 } },
      ],
    };
    const active = getActiveTaskNodes(raw);
    const answers = initializeIntakeAnswers(raw, active);

    assert.equal(answers.steps.t_quick.speed.value, 'quick');
    assert.equal(answers.steps.t_quick.speed.estimated, false);

    assert.equal(answers.steps.t_normal.speed.value, 'normal');
    assert.equal(answers.steps.t_normal.speed.estimated, true);

    assert.equal(answers.steps.t_slow.speed.value, 'slow');
    assert.equal(answers.steps.t_slow.speed.estimated, true);
  });

  it('pre-fills exceptions from diagram edge labels', () => {
    const raw = {
      nodes: [{ id: 't1', type: 'task' }],
      edges: [
        { source: 't1', target: 'e1', label: 'Item out of stock' },
        { source: 't1', target: 'e2', data: { label: 'Customer refund' } },
      ],
    };
    const active = getActiveTaskNodes(raw);
    const answers = initializeIntakeAnswers(raw, active);

    assert.deepEqual(answers.exceptions.value, ['Out of stock', 'Refund']);
  });

  it('pre-fills limited space and units from facility resource', () => {
    const raw = {
      nodes: [{ id: 't1', type: 'task' }],
      resources: [{ type: 'facility', name: 'Booth', quantity: 6 }],
    };
    const active = getActiveTaskNodes(raw);
    const answers = initializeIntakeAnswers(raw, active);

    assert.equal(answers.hasLimitedSpace.value, true);
    assert.equal(answers.spaceName.value, 'Booth');
    assert.equal(answers.spaceUnits.value, 6);
  });

  it('pre-fills costs from staff monthly_salary values', () => {
    const raw = {
      nodes: [{ id: 't1', type: 'task' }],
      resources: [
        { type: 'staff', name: 'Chef', monthly_salary: 65000 },
        { type: 'staff', name: 'Server', monthly_salary: 42000 },
      ],
    };
    const active = getActiveTaskNodes(raw);
    const answers = initializeIntakeAnswers(raw, active);

    assert.equal(answers.costs.value.Chef, 65000);
    assert.equal(answers.costs.value.Server, 42000);
  });
});

describe('Module I3: Final Answers Builder and I1 Schema Compatibility', () => {
  it('builds final answers conforming to I1 schema and excludes unkept inferred steps', () => {
    const raw = {
      nodes: [
        { id: 'start_1', type: 'start-event' },
        { id: 'task_order', type: 'task', origin: 'stated' },
        { id: 'task_inferred_unkept', type: 'task', origin: 'inferred', kept: false },
        { id: 'end_1', type: 'end-event' },
      ],
      resources: [{ type: 'staff', name: 'Staff' }],
    };

    const active = getActiveTaskNodes(raw);
    const state = initializeIntakeAnswers(raw, active);

    // Modify a user answer
    state.steps.task_order = {
      speed: wrapValue('quick', 'tap', false),
      staffRoles: wrapValue(['Staff'], 'tap', false),
    };
    state.busyness = wrapValue('packed', 'tap', false);
    state.goal = wrapValue('throughput', 'tap', false);

    const finalAnswers = buildFinalAnswers(raw, state, active);

    // Verify answers structure
    assert.equal(finalAnswers.busyness.value, 'packed');
    assert.equal(finalAnswers.busyness.source, 'tap');
    assert.equal(finalAnswers.goal.value, 'throughput');

    assert.equal(finalAnswers.steps.task_order.speed.value, 'quick');
    assert.deepEqual(finalAnswers.steps.task_order.staffRoles.value, ['Staff']);
    assert.equal(finalAnswers.steps.task_order.kept, true);

    // Unkept inferred node must be kept: false
    assert.equal(finalAnswers.steps.task_inferred_unkept.kept, false);

    // Integrate into applyIntakeToRawDiagram pure function
    const result = applyIntakeToRawDiagram(raw, finalAnswers);
    assert.ok(result.patched);
    assert.ok(result.simulationConfig);

    // Speed applied to stated task
    const patchedTaskOrder = result.patched.nodes.find((n) => n.id === 'task_order');
    assert.equal(patchedTaskOrder.data.duration, 1);
    assert.equal(patchedTaskOrder.data.resource, 'Staff');

    // Unkept inferred task must have duration 0 and no resources
    const patchedInferred = result.patched.nodes.find((n) => n.id === 'task_inferred_unkept');
    assert.equal(patchedInferred.data.duration, 0);
    assert.equal(patchedInferred.data.resource, null);

    // Simulation config mapped
    assert.equal(result.simulationConfig.busyness, 'packed');
    assert.equal(result.simulationConfig.customers_per_hour, 45);
    assert.equal(result.simulationConfig.goal, 'throughput');
  });

  it('handles "Not sure" defaults flagged as estimated: true', () => {
    const raw = {
      nodes: [{ id: 'task_1', type: 'task', origin: 'stated' }],
    };
    const active = getActiveTaskNodes(raw);
    const state = initializeIntakeAnswers(raw, active);

    // Owner was "Not sure" about busyness, space, and speed
    state.steps.task_1.speed = wrapValue(DEFAULT_SPEED, 'default', true);
    state.busyness = wrapValue(DEFAULT_BUSYNESS, 'default', true);
    state.goal = wrapValue(DEFAULT_GOAL, 'default', true);
    state.hasLimitedSpace = wrapValue(false, 'default', true);

    const finalAnswers = buildFinalAnswers(raw, state, active);
    const result = applyIntakeToRawDiagram(raw, finalAnswers);

    // Must record estimated assumptions
    const busynessAssumption = result.assumptions.find((a) => a.field === 'busyness');
    assert.ok(busynessAssumption);
    assert.equal(busynessAssumption.estimated, true);

    const speedAssumption = result.assumptions.find((a) => a.field === 'steps.task_1.speed');
    assert.ok(speedAssumption);
    assert.equal(speedAssumption.estimated, true);

    const crowdingAssumption = result.assumptions.find((a) => a.field === 'crowding');
    assert.ok(crowdingAssumption);
  });
});
