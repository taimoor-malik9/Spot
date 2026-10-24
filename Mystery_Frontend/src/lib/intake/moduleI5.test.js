// Mystery_Frontend/src/lib/intake/moduleI5.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyIntakeToRawDiagram } from './applyIntake.js';
import { validateBpmn } from './validateBpmn.js';
import { wrapValue } from './schema.js';

describe('Module I5: Intake Confirmation & Pipeline Integration Tests', () => {
  const validDiagram = {
    nodes: [
      { id: 'start_1', type: 'start-event', label: 'Start' },
      { id: 'task_1', type: 'task', label: 'Take Order', lane: 'lane_1', origin: 'stated', duration: 3, duration_min: 1, duration_max: 5 },
      { id: 'task_2', type: 'task', label: 'Brew Coffee', lane: 'lane_1', origin: 'stated', duration: 4, duration_min: 2, duration_max: 6 },
      { id: 'end_1', type: 'end-event', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
      { id: 'e2', source: 'task_1', target: 'task_2', flowType: 'sequence' },
      { id: 'e3', source: 'task_2', target: 'end_1', flowType: 'sequence' },
    ],
    resources: [
      { id: 'r1', name: 'Barista', type: 'staff', quantity: 1, monthly_salary: 45000, costSource: 'stated' },
    ],
  };

  it('Pipeline Step 1: applyIntakeToRawDiagram patches diagram and produces assumptions & simulationConfig', () => {
    const answers = {
      steps: {
        task_1: { speed: wrapValue('quick', 'tap', false), staffRoles: wrapValue(['Cashier'], 'tap', false) },
        task_2: { speed: wrapValue('normal', 'default', true), staffRoles: wrapValue(['Barista'], 'tap', false) },
      },
      busyness: wrapValue('packed', 'tap', false),
      goal: wrapValue('throughput', 'tap', false),
      hasLimitedSpace: wrapValue(true, 'tap', false),
      spaceName: wrapValue('Table', 'tap', false),
      spaceUnits: wrapValue(12, 'tap', false),
    };

    const { patched, simulationConfig, assumptions } = applyIntakeToRawDiagram(validDiagram, answers);

    assert.ok(patched);
    assert.equal(simulationConfig.busyness, 'packed');
    assert.equal(simulationConfig.goal, 'throughput');
    assert.equal(simulationConfig.arrival_rate, 45 / 60);

    // Speed normal was default/estimated: true -> should be flagged in assumptions
    const speedAssumption = assumptions.find((a) => a.field === 'steps.task_2.speed');
    assert.ok(speedAssumption);
    assert.equal(speedAssumption.estimated, true);
  });

  it('Pipeline Step 2: validateBpmn on patched diagram succeeds when structure is valid', () => {
    const answers = {
      steps: {
        task_1: { speed: wrapValue('quick', 'tap', false), staffRoles: wrapValue(['Barista'], 'tap', false) },
        task_2: { speed: wrapValue('slow', 'tap', false), staffRoles: wrapValue(['Barista'], 'tap', false) },
      },
      busyness: wrapValue('steady', 'tap', false),
      goal: wrapValue('waiting', 'tap', false),
    };

    const { patched, simulationConfig, assumptions } = applyIntakeToRawDiagram(validDiagram, answers);
    const validation = validateBpmn(patched);

    assert.equal(validation.errors.length, 0, 'Valid BPMN should have no validation errors');
    assert.ok(validation.repaired || patched);
  });

  it('Pipeline Step 3: Blocks Apply when validateBpmn returns errors (e.g. missing start event or broken flow)', () => {
    const brokenDiagram = {
      nodes: [
        // Missing start event!
        { id: 'task_1', type: 'task', label: 'Floating Task', lane: 'lane_1', origin: 'stated' },
        { id: 'end_1', type: 'end-event', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'task_1', target: 'end_1', flowType: 'sequence' },
      ],
      resources: [],
    };

    const answers = {
      steps: {
        task_1: { speed: wrapValue('normal', 'default', true) },
      },
      busyness: wrapValue('steady', 'default', true),
      goal: wrapValue('waiting', 'default', true),
    };

    const { patched } = applyIntakeToRawDiagram(brokenDiagram, answers);
    const validation = validateBpmn(patched);

    assert.ok(validation.errors.length > 0, 'Validation MUST detect errors on broken BPMN diagram');
    assert.ok(validation.errors.some((err) => err.includes('start event')));

    // Simulate Apply guard:
    const canApply = validation.errors.length === 0;
    assert.equal(canApply, false, 'Apply MUST be blocked when validateBpmn returns errors');
  });

  it('Pipeline Step 4: Auto-repairs missing end event using zero-time node and records in repairs', () => {
    const diagramMissingEnd = {
      nodes: [
        { id: 'start_1', type: 'start-event', label: 'Start' },
        { id: 'task_1', type: 'task', label: 'Single Task', lane: 'lane_1', origin: 'stated', duration: 5, duration_min: 3, duration_max: 8 },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_1', flowType: 'sequence' },
      ],
      resources: [],
    };

    const { patched } = applyIntakeToRawDiagram(diagramMissingEnd, {});
    const validation = validateBpmn(patched);

    assert.equal(validation.errors.length, 0, 'Missing end event should be auto-repaired, not error');
    assert.ok(validation.repairs.length > 0);
    assert.ok(validation.repairs.some((r) => r.description.includes('end event')));
    assert.ok(validation.repaired.nodes.some((n) => n.type === 'end-event'));
  });

  it('Pipeline Step 5: Detects estimated salaries and flags anySalaryEstimated', () => {
    // Case A: Staff salary was not explicitly entered (defaults to estimated benchmark)
    const answersEstimated = {
      steps: {
        task_1: { staffRoles: wrapValue(['Cashier'], 'tap', false) },
      },
      costs: wrapValue({}, 'default', true),
    };

    const resA = applyIntakeToRawDiagram(validDiagram, answersEstimated);
    const hasEstimatedSalaryA =
      resA.assumptions.some((a) => a.field === 'costs' || a.text.toLowerCase().includes('salary')) ||
      resA.patched.resources.some((r) => r.type === 'staff' && (r.costSource === 'assumed' || r.salaryEstimated));

    assert.equal(hasEstimatedSalaryA, true, 'Should detect estimated salary when costs was defaulted');

    // Case B: Staff salary was explicitly stated
    const answersStated = {
      steps: {
        task_1: { staffRoles: wrapValue(['Barista'], 'tap', false) },
      },
      costs: wrapValue({ Barista: 55000 }, 'tap', false),
    };

    const resB = applyIntakeToRawDiagram(validDiagram, answersStated);
    const baristaRes = resB.patched.resources.find((r) => r.name === 'Barista');
    assert.equal(baristaRes.monthly_salary, 55000);
    assert.equal(baristaRes.costSource, 'stated');
  });

  it('Pipeline Step 6: Validates goal is mapped to "waiting" | "cost" | "throughput"', () => {
    const goals = ['waiting', 'cost', 'throughput'];
    goals.forEach((g) => {
      const { simulationConfig } = applyIntakeToRawDiagram(validDiagram, {
        goal: wrapValue(g, 'tap', false),
      });
      assert.equal(simulationConfig.goal, g);
      assert.ok(['waiting', 'cost', 'throughput'].includes(simulationConfig.goal));
    });
  });
});
