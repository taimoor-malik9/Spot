/**
 * lib/intake/intake.test.js
 *
 * Unit tests for guided intake schema, mappings, and applyIntake logic.
 * Run with: node --test src/lib/intake/intake.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEED_MAPPINGS,
  BUSYNESS_MAPPINGS,
  DEFAULT_SPEED,
  DEFAULT_BUSYNESS,
  DEFAULT_GOAL,
  wrapValue,
  unwrapValue,
  Assumption,
  createDefaultAnswers,
} from './schema.js';
import { applyIntakeToRawDiagram } from './applyIntake.js';

function createBaseDiagram() {
  return {
    type: 'diagram',
    summary: 'Sample diagram',
    nodes: [
      { id: 'start_1', type: 'start-event', data: { label: 'Start' } },
      { id: 'task_prep', type: 'task', data: { label: 'Prepare Order', duration: 10 } },
      { id: 'task_pack', type: 'task', data: { label: 'Pack Box', duration: 10 } },
      { id: 'end_1', type: 'end-event', data: { label: 'End' } },
    ],
    edges: [
      { id: 'e1', source: 'start_1', target: 'task_prep', flowType: 'sequence' },
      { id: 'e2', source: 'task_prep', target: 'task_pack', flowType: 'sequence' },
      { id: 'e3', source: 'task_pack', target: 'end_1', flowType: 'sequence' },
    ],
    resources: [
      { id: 'Staff', name: 'Staff', displayName: 'Staff', type: 'staff', quantity: 2 },
    ],
  };
}

describe('Intake Schema Mappings', () => {
  it('maps quick speed to 1/1/2 minutes', () => {
    assert.deepEqual(SPEED_MAPPINGS.quick, {
      duration_min: 1,
      duration: 1,
      duration_max: 2,
      duration_unit: 'minutes',
    });
  });

  it('maps normal speed to 3/5/8 minutes', () => {
    assert.deepEqual(SPEED_MAPPINGS.normal, {
      duration_min: 3,
      duration: 5,
      duration_max: 8,
      duration_unit: 'minutes',
    });
  });

  it('maps slow speed to 10/15/25 minutes', () => {
    assert.deepEqual(SPEED_MAPPINGS.slow, {
      duration_min: 10,
      duration: 15,
      duration_max: 25,
      duration_unit: 'minutes',
    });
  });

  it('maps quiet busyness to 5 customers/hr, 12 min arrival gap, 5/60 arrival rate', () => {
    const q = BUSYNESS_MAPPINGS.quiet;
    assert.equal(q.customers_per_hour, 5);
    assert.equal(q.arrival_gap_minutes, 12);
    assert.equal(q.arrival_rate, 5 / 60);
  });

  it('maps steady busyness to 20 customers/hr, 3 min arrival gap, 20/60 arrival rate', () => {
    const s = BUSYNESS_MAPPINGS.steady;
    assert.equal(s.customers_per_hour, 20);
    assert.equal(s.arrival_gap_minutes, 3);
    assert.equal(s.arrival_rate, 20 / 60);
  });

  it('maps packed busyness to 45 customers/hr, 1.33 min arrival gap, 45/60 arrival rate', () => {
    const p = BUSYNESS_MAPPINGS.packed;
    assert.equal(p.customers_per_hour, 45);
    assert.equal(p.arrival_gap_minutes, 60 / 45);
    assert.equal(p.arrival_rate, 45 / 60);
  });
});

describe('Value Wrapping & Provenance Utilities', () => {
  it('wrapValue produces expected structure', () => {
    assert.deepEqual(wrapValue('quick', 'tap', false), {
      value: 'quick',
      source: 'tap',
      estimated: false,
    });
    assert.deepEqual(wrapValue('normal', 'default', true), {
      value: 'normal',
      source: 'default',
      estimated: true,
    });
  });

  it('unwrapValue extracts raw values and unwraps objects', () => {
    // Raw value
    assert.deepEqual(unwrapValue('quick', 'normal'), {
      value: 'quick',
      source: 'tap',
      estimated: false,
    });

    // Object with source and estimated
    assert.deepEqual(unwrapValue({ value: 'slow', source: 'typed', estimated: false }, 'normal'), {
      value: 'slow',
      source: 'typed',
      estimated: false,
    });

    // 'unsure' keyword maps to fallback with estimated: true
    assert.deepEqual(unwrapValue('unsure', 'normal'), {
      value: 'normal',
      source: 'tap',
      estimated: true,
    });

    // Wrapped object with value 'unsure' maps to fallback with estimated: true
    assert.deepEqual(unwrapValue({ value: 'unsure', source: 'tap' }, 'steady'), {
      value: 'steady',
      source: 'tap',
      estimated: true,
    });

    // Missing value maps to fallback with default source and estimated: true
    assert.deepEqual(unwrapValue(undefined, 'waiting'), {
      value: 'waiting',
      source: 'default',
      estimated: true,
    });
  });
});

describe('applyIntakeToRawDiagram Purity and Rules', () => {
  it('is pure: does not mutate rawDiagram or answers', () => {
    const raw = createBaseDiagram();
    const answers = {
      busyness: 'steady',
      steps: {
        task_prep: { speed: 'quick' },
      },
    };

    // Deep freeze inputs to guarantee no mutation occurs
    const deepFreeze = (obj) => {
      Object.keys(obj).forEach((prop) => {
        if (typeof obj[prop] === 'object' && obj[prop] !== null) deepFreeze(obj[prop]);
      });
      return Object.freeze(obj);
    };

    deepFreeze(raw);
    deepFreeze(answers);

    const { patched } = applyIntakeToRawDiagram(raw, answers);
    assert.notEqual(patched, raw);
    assert.equal(patched.nodes[1].data.duration, 1);
  });

  it('always includes the assumption "Crowding is not modeled"', () => {
    const raw = createBaseDiagram();
    const { assumptions } = applyIntakeToRawDiagram(raw, {});
    const crowding = assumptions.find((a) => a.text === 'Crowding is not modeled');
    assert.ok(crowding, 'Assumption "Crowding is not modeled" must be present');
    assert.equal(crowding.field, 'crowding');
  });
});

describe('Speed Mappings in applyIntakeToRawDiagram', () => {
  it('applies quick speed (1/1/2 min) to stated node', () => {
    const raw = createBaseDiagram();
    const answers = {
      steps: {
        task_prep: { speed: 'quick' },
      },
    };

    const { patched } = applyIntakeToRawDiagram(raw, answers);
    const node = patched.nodes.find((n) => n.id === 'task_prep');
    assert.equal(node.data.duration_min, 1);
    assert.equal(node.data.duration, 1);
    assert.equal(node.data.duration_max, 2);
    assert.equal(node.data.duration_unit, 'minutes');
    assert.equal(node.data.duration_source, 'stated');
  });

  it('applies normal speed (3/5/8 min) to stated node', () => {
    const raw = createBaseDiagram();
    const answers = {
      steps: {
        task_prep: { speed: 'normal' },
      },
    };

    const { patched } = applyIntakeToRawDiagram(raw, answers);
    const node = patched.nodes.find((n) => n.id === 'task_prep');
    assert.equal(node.data.duration_min, 3);
    assert.equal(node.data.duration, 5);
    assert.equal(node.data.duration_max, 8);
    assert.equal(node.data.duration_unit, 'minutes');
    assert.equal(node.data.duration_source, 'stated');
  });

  it('applies slow speed (10/15/25 min) to stated node', () => {
    const raw = createBaseDiagram();
    const answers = {
      steps: {
        task_prep: { speed: 'slow' },
      },
    };

    const { patched } = applyIntakeToRawDiagram(raw, answers);
    const node = patched.nodes.find((n) => n.id === 'task_prep');
    assert.equal(node.data.duration_min, 10);
    assert.equal(node.data.duration, 15);
    assert.equal(node.data.duration_max, 25);
    assert.equal(node.data.duration_unit, 'minutes');
    assert.equal(node.data.duration_source, 'stated');
  });

  it('defaults unsure or missing speed to normal (3/5/8 min) flagged with estimated: true', () => {
    const raw = createBaseDiagram();
    const answers = {
      steps: {
        task_prep: { speed: 'unsure' },
        // task_pack is omitted to test missing fallback
      },
    };

    const { patched, assumptions } = applyIntakeToRawDiagram(raw, answers);

    // Unsure step
    const prepNode = patched.nodes.find((n) => n.id === 'task_prep');
    assert.equal(prepNode.data.duration_min, 3);
    assert.equal(prepNode.data.duration, 5);
    assert.equal(prepNode.data.duration_max, 8);
    assert.equal(prepNode.data.duration_source, 'assumed');

    // Missing step
    const packNode = patched.nodes.find((n) => n.id === 'task_pack');
    assert.equal(packNode.data.duration_min, 3);
    assert.equal(packNode.data.duration, 5);
    assert.equal(packNode.data.duration_max, 8);
    assert.equal(packNode.data.duration_source, 'assumed');

    // Check assumptions contain estimated flags
    const prepAssumption = assumptions.find((a) => a.field === 'steps.task_prep.speed');
    assert.ok(prepAssumption);
    assert.equal(prepAssumption.estimated, true);

    const packAssumption = assumptions.find((a) => a.field === 'steps.task_pack.speed');
    assert.ok(packAssumption);
    assert.equal(packAssumption.estimated, true);
  });
});

describe('Busyness & SimulationConfig Mappings', () => {
  it('maps quiet busyness to simulationConfig with arrival_rate 5/60', () => {
    const raw = createBaseDiagram();
    const { simulationConfig } = applyIntakeToRawDiagram(raw, { busyness: 'quiet' });

    assert.equal(simulationConfig.busyness, 'quiet');
    assert.equal(simulationConfig.customers_per_hour, 5);
    assert.equal(simulationConfig.arrival_gap_minutes, 12);
    assert.equal(simulationConfig.arrival_rate, 5 / 60);
  });

  it('maps steady busyness to simulationConfig with arrival_rate 20/60', () => {
    const raw = createBaseDiagram();
    const { simulationConfig } = applyIntakeToRawDiagram(raw, { busyness: 'steady' });

    assert.equal(simulationConfig.busyness, 'steady');
    assert.equal(simulationConfig.customers_per_hour, 20);
    assert.equal(simulationConfig.arrival_gap_minutes, 3);
    assert.equal(simulationConfig.arrival_rate, 20 / 60);
  });

  it('maps packed busyness to simulationConfig with arrival_rate 45/60', () => {
    const raw = createBaseDiagram();
    const { simulationConfig } = applyIntakeToRawDiagram(raw, { busyness: 'packed' });

    assert.equal(simulationConfig.busyness, 'packed');
    assert.equal(simulationConfig.customers_per_hour, 45);
    assert.equal(simulationConfig.arrival_gap_minutes, 60 / 45);
    assert.equal(simulationConfig.arrival_rate, 45 / 60);
  });

  it('defaults unsure or missing busyness to steady with estimated: true in assumptions', () => {
    const raw = createBaseDiagram();

    // Test missing busyness
    const res1 = applyIntakeToRawDiagram(raw, {});
    assert.equal(res1.simulationConfig.busyness, 'steady');
    assert.equal(res1.simulationConfig.arrival_rate, 20 / 60);
    const busynessAssumption1 = res1.assumptions.find((a) => a.field === 'busyness');
    assert.ok(busynessAssumption1);
    assert.equal(busynessAssumption1.estimated, true);

    // Test unsure busyness
    const res2 = applyIntakeToRawDiagram(raw, { busyness: 'unsure' });
    assert.equal(res2.simulationConfig.busyness, 'steady');
    assert.equal(res2.simulationConfig.arrival_rate, 20 / 60);
    const busynessAssumption2 = res2.assumptions.find((a) => a.field === 'busyness');
    assert.ok(busynessAssumption2);
    assert.equal(busynessAssumption2.estimated, true);
  });
});

describe('Goal Mappings in simulationConfig', () => {
  it('maps stated goal to simulationConfig', () => {
    const raw = createBaseDiagram();
    const { simulationConfig } = applyIntakeToRawDiagram(raw, { goal: 'cost' });
    assert.equal(simulationConfig.goal, 'cost');
  });

  it('defaults unsure or missing goal to waiting with estimated: true', () => {
    const raw = createBaseDiagram();
    const { simulationConfig, assumptions } = applyIntakeToRawDiagram(raw, { goal: 'unsure' });
    assert.equal(simulationConfig.goal, 'waiting');
    const goalAssumption = assumptions.find((a) => a.field === 'goal');
    assert.ok(goalAssumption);
    assert.equal(goalAssumption.estimated, true);
  });
});

describe('Inferred Nodes Rule', () => {
  it('never applies speed or staff to unkept nodes with origin: "inferred" and sets duration to 0', () => {
    const raw = createBaseDiagram();
    raw.nodes.push({
      id: 'task_inferred_auto',
      type: 'task',
      origin: 'inferred',
      data: { label: 'Automated Check', duration: 10 },
    });

    const answers = {
      steps: {
        task_inferred_auto: { speed: 'slow', staffRoles: ['Inspector'] },
      },
    };

    const { patched } = applyIntakeToRawDiagram(raw, answers);
    const node = patched.nodes.find((n) => n.id === 'task_inferred_auto');

    // Must have duration 0 and no resources
    assert.equal(node.data.duration, 0);
    assert.equal(node.data.duration_min, 0);
    assert.equal(node.data.duration_max, 0);
    assert.equal(node.data.resource, null);
    assert.deepEqual(node.data.resources, {});
  });

  it('applies speed and staff to inferred node when marked kept: true', () => {
    const raw = createBaseDiagram();
    raw.nodes.push({
      id: 'task_inferred_auto',
      type: 'task',
      origin: 'inferred',
      data: { label: 'Automated Check', duration: 0 },
    });

    const answers = {
      steps: {
        task_inferred_auto: { speed: 'quick', staffRoles: ['Inspector'], kept: true },
      },
    };

    const { patched } = applyIntakeToRawDiagram(raw, answers);
    const node = patched.nodes.find((n) => n.id === 'task_inferred_auto');

    // Kept is true, so speed and staff are applied
    assert.equal(node.data.duration, 1);
    assert.equal(node.data.duration_min, 1);
    assert.equal(node.data.duration_max, 2);
    assert.deepEqual(node.data.resources, { Inspector: 1 });
  });
});

describe('Limited Space Resource Mapping', () => {
  it('adds a space resource ONLY when hasLimitedSpace is true, attached to the chosen step', () => {
    const raw = createBaseDiagram();
    const answers = {
      hasLimitedSpace: true,
      spaceName: 'Exam Room',
      spaceUnits: 4,
      spaceStepId: 'task_prep',
    };

    const { patched } = applyIntakeToRawDiagram(raw, answers);

    // Verify facility resource added
    const spaceRes = patched.resources.find((r) => r.name === 'Exam Room');
    assert.ok(spaceRes, 'Facility resource "Exam Room" should be added');
    assert.equal(spaceRes.type, 'facility');
    assert.equal(spaceRes.quantity, 4);

    // Verify attached to chosen step
    const prepNode = patched.nodes.find((n) => n.id === 'task_prep');
    assert.equal(prepNode.data.resources['Exam Room'], 1);

    // Verify not attached to other steps
    const packNode = patched.nodes.find((n) => n.id === 'task_pack');
    assert.equal(packNode.data.resources?.['Exam Room'], undefined);
  });

  it('does NOT add space resource when hasLimitedSpace is false', () => {
    const raw = createBaseDiagram();
    const answers = {
      hasLimitedSpace: false,
      spaceName: 'Exam Room',
      spaceUnits: 4,
    };

    const { patched } = applyIntakeToRawDiagram(raw, answers);
    const spaceRes = patched.resources.find((r) => r.type === 'facility');
    assert.equal(spaceRes, undefined);
  });

  it('does NOT add space resource when hasLimitedSpace is null/missing, and records assumption', () => {
    const raw = createBaseDiagram();
    const answers = {
      hasLimitedSpace: null,
    };

    const { patched, assumptions } = applyIntakeToRawDiagram(raw, answers);
    const spaceRes = patched.resources.find((r) => r.type === 'facility');
    assert.equal(spaceRes, undefined);

    const spaceAssumption = assumptions.find((a) => a.field === 'hasLimitedSpace');
    assert.ok(spaceAssumption);
    assert.equal(spaceAssumption.estimated, true);
  });
});

describe('Staff Roles and Costs Mapping', () => {
  it('attaches staffRoles and updates salary costs', () => {
    const raw = createBaseDiagram();
    const answers = {
      steps: {
        task_prep: { speed: 'normal', staffRoles: ['Chef'] },
      },
      costs: {
        Chef: 75000,
      },
    };

    const { patched } = applyIntakeToRawDiagram(raw, answers);
    const prepNode = patched.nodes.find((n) => n.id === 'task_prep');
    assert.deepEqual(prepNode.data.resources, { Chef: 1 });

    const chefRes = patched.resources.find((r) => r.name === 'Chef');
    assert.ok(chefRes);
    assert.equal(chefRes.monthly_salary, 75000);
    assert.equal(chefRes.costSource, 'stated');
  });
});

describe('Fallback Space Step and Default Answers Factory', () => {
  it('attaches space to first active task when spaceStepId is not explicitly specified', () => {
    const raw = createBaseDiagram();
    const answers = {
      hasLimitedSpace: true,
      spaceName: 'Waiting Area',
      spaceUnits: 10,
    };

    const { patched, assumptions } = applyIntakeToRawDiagram(raw, answers);
    const firstTask = patched.nodes.find((n) => n.id === 'task_prep');
    assert.equal(firstTask.data.resources['Waiting Area'], 1);

    const fallbackAssumption = assumptions.find((a) => a.field === 'spaceStepId');
    assert.ok(fallbackAssumption);
    assert.equal(fallbackAssumption.estimated, true);
  });

  it('createDefaultAnswers produces valid answers object seeded from raw diagram', () => {
    const raw = createBaseDiagram();
    const defaults = createDefaultAnswers(raw);

    assert.equal(defaults.busyness.value, 'steady');
    assert.equal(defaults.busyness.estimated, true);
    assert.equal(defaults.hasLimitedSpace.value, false);
    assert.equal(defaults.hasLimitedSpace.estimated, true);
    assert.ok(defaults.steps.task_prep);
    assert.equal(defaults.steps.task_prep.speed.value, 'normal');
    assert.equal(defaults.steps.task_prep.speed.estimated, true);
  });
});

