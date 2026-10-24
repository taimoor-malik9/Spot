import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractOrderedSteps } from './stepListHelper.js';
import { getInitialGuidedState, GUIDED_STORAGE_KEY } from './guidedState.js';

describe('Module I2e: ProcessStepList & Step Extraction', () => {
  it('extracts steps in sequential order from start event', () => {
    const rawDiagram = {
      nodes: [
        { id: 'start_1', type: 'start-event', label: 'Order Begun' },
        { id: 'task_1', type: 'task', label: 'Browse Menu', lane: 'Customer' },
        { id: 'task_2', type: 'task', label: 'Prepare Coffee', lane: 'Barista' },
        { id: 'end_1', type: 'end-event', label: 'Order Fulfilled' },
      ],
      edges: [
        { id: 'e1', source: 'start_1', target: 'task_1' },
        { id: 'e2', source: 'task_1', target: 'task_2' },
        { id: 'e3', source: 'task_2', target: 'end_1' },
      ],
    };

    const steps = extractOrderedSteps(rawDiagram);
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].id, 'task_1');
    assert.strictEqual(steps[0].label, 'Browse Menu');
    assert.strictEqual(steps[1].id, 'task_2');
    assert.strictEqual(steps[1].label, 'Prepare Coffee');
  });

  it('groups steps into Customer and Store correctly based on lane or label', () => {
    const rawDiagram = {
      nodes: [
        { id: 'task_cust', type: 'task', label: 'Customer places order', lane: 'Customer' },
        { id: 'task_staff', type: 'task', label: 'Staff rings up bill', lane: 'Cashier' },
      ],
      edges: [
        { id: 'e1', source: 'task_cust', target: 'task_staff' },
      ],
    };

    const steps = extractOrderedSteps(rawDiagram);
    const customerStep = steps.find(s => s.id === 'task_cust');
    const storeStep = steps.find(s => s.id === 'task_staff');

    assert.strictEqual(customerStep.group, 'Customer');
    assert.strictEqual(storeStep.group, 'Store');
  });

  it('identifies branch conditions from decision gateways ("If <question> -> <step>")', () => {
    const rawDiagram = {
      nodes: [
        { id: 'gw_1', type: 'exclusive-gateway', label: 'Is Drink Cold?' },
        { id: 'task_iced', type: 'task', label: 'Add Ice to Cup', lane: 'Barista' },
        { id: 'task_hot', type: 'task', label: 'Steam Fresh Milk', lane: 'Barista' },
      ],
      edges: [
        { id: 'e1', source: 'gw_1', target: 'task_iced', label: 'Yes' },
        { id: 'e2', source: 'gw_1', target: 'task_hot', label: 'No' },
      ],
    };

    const steps = extractOrderedSteps(rawDiagram);
    const iced = steps.find(s => s.id === 'task_iced');
    const hot = steps.find(s => s.id === 'task_hot');

    assert.ok(iced.branchCondition.includes('Is Drink Cold?'));
    assert.ok(iced.branchCondition.includes('Yes'));
    assert.ok(hot.branchCondition.includes('Is Drink Cold?'));
    assert.ok(hot.branchCondition.includes('No'));
  });

  it('correctly tags inferred steps with isInferred: true and preserves kept state', () => {
    const rawDiagram = {
      nodes: [
        { id: 'task_normal', type: 'task', label: 'Order Drink', origin: 'stated' },
        { id: 'task_inferred', type: 'task', label: 'Sanitize Work Station', origin: 'inferred', kept: false },
        { id: 'task_kept', type: 'task', label: 'Restock Napkins', origin: 'inferred', kept: true },
      ],
      edges: [],
    };

    const steps = extractOrderedSteps(rawDiagram);
    const normal = steps.find(s => s.id === 'task_normal');
    const inferred = steps.find(s => s.id === 'task_inferred');
    const kept = steps.find(s => s.id === 'task_kept');

    assert.strictEqual(normal.isInferred, false);
    assert.strictEqual(inferred.isInferred, true);
    assert.strictEqual(inferred.isKept, false);
    assert.strictEqual(kept.isInferred, true);
    assert.strictEqual(kept.isKept, true);
  });
});

describe('Module I2e: Single Source of Truth & State Restoration', () => {
  it('returns valid initial state structure with version counter', () => {
    const init = getInitialGuidedState();
    assert.strictEqual(init.flowText, '');
    assert.strictEqual(init.rawDiagram, null);
    assert.strictEqual(init.version, 1);
    assert.deepStrictEqual(init.keptSteps, []);
    assert.strictEqual(init.answers, null);
    assert.strictEqual(init.currentStep, 1);
    assert.deepStrictEqual(init.validationResult, { errors: [], repairs: [] });
  });

  it('defines the sessionStorage key spot:guidedState', () => {
    assert.strictEqual(GUIDED_STORAGE_KEY, 'spot:guidedState');
  });
});
