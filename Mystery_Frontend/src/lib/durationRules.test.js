import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateDurationRules, normalizeRanges, isTaskType } from './durationRules.js';
import { shapeFrontendToBackend, shapeBackendToFrontend } from './apiService.js';

describe('Module D1b: Duration Rules Based on Activity Origin', () => {

  it('1. A stated task with no duration -> error', () => {
    const nodes = [
      {
        id: 'task_1',
        type: 'task',
        label: 'Take Order',
        origin: 'stated',
        data: {
          label: 'Take Order',
          origin: 'stated',
          duration: 0,
        },
      },
    ];

    const result = validateDurationRules(nodes);
    assert.strictEqual(result.errors.length, 1, 'Should report 1 error');
    assert.strictEqual(result.errors[0].nodeId, 'task_1');
    assert.strictEqual(result.errors[0].message, 'Take Order needs a duration.');
    assert.ok(result.errorNodeIds.has('task_1'));
    assert.strictEqual(result.summary, '1 step needs a duration');
  });

  it('2. The same task with an intake "Not sure" estimate -> no error, tagged estimated', () => {
    const nodes = [
      {
        id: 'task_1',
        type: 'task',
        label: 'Take Order',
        origin: 'stated',
        data: {
          label: 'Take Order',
          origin: 'stated',
          duration: 5,
          estimated: true,
        },
      },
    ];

    const result = validateDurationRules(nodes);
    assert.strictEqual(result.errors.length, 0, 'Estimated duration should not produce an error');
    assert.strictEqual(nodes[0].data.estimated, true, 'Task remains tagged as estimated');
  });

  it('3. A structural node -> never errors', () => {
    const nodes = [
      {
        id: 'start_1',
        type: 'start-event',
        label: 'Start',
        origin: 'structural',
        data: { label: 'Start', origin: 'structural', duration: 0 },
      },
      {
        id: 'gw_1',
        type: 'exclusive-gateway',
        label: 'Decision?',
        origin: 'structural',
        data: { label: 'Decision?', origin: 'structural', duration: 0 },
      },
      {
        id: 'task_repair',
        type: 'task',
        label: 'Complete Process',
        origin: 'structural',
        data: { label: 'Complete Process', origin: 'structural', duration: 0, resources: {} },
      },
      {
        id: 'end_1',
        type: 'end-event',
        label: 'End',
        origin: 'structural',
        data: { label: 'End', origin: 'structural', duration: 0 },
      },
    ];

    const result = validateDurationRules(nodes);
    assert.strictEqual(result.errors.length, 0, 'Structural nodes must never error on duration');
    assert.strictEqual(result.errorNodeIds.size, 0);
  });

  it('4. An inferred step -> no duration error but listed as unresolved', () => {
    const nodes = [
      {
        id: 'task_inferred',
        type: 'task',
        label: 'Sanitize Work Station',
        origin: 'inferred',
        kept: false,
        data: {
          label: 'Sanitize Work Station',
          origin: 'inferred',
          kept: false,
          duration: 0,
        },
      },
    ];

    const result = validateDurationRules(nodes);
    assert.strictEqual(result.errors.length, 0, 'Unkept inferred task is exempt from duration error');
    assert.strictEqual(result.unresolvedInferred.length, 1, 'Must be counted as unresolved');
    assert.strictEqual(result.unresolvedInferred[0].nodeId, 'task_inferred');
    assert.strictEqual(result.unresolvedInferred[0].message, 'AI suggested this step: Keep or Remove');
  });

  it('5. Keep then empty duration -> error', () => {
    const nodes = [
      {
        id: 'task_inferred_kept',
        type: 'task',
        label: 'Sanitize Work Station',
        origin: 'inferred',
        kept: true,
        data: {
          label: 'Sanitize Work Station',
          origin: 'inferred',
          kept: true,
          duration: 0,
        },
      },
    ];

    const result = validateDurationRules(nodes);
    assert.strictEqual(result.errors.length, 1, 'Kept inferred task requires duration > 0');
    assert.strictEqual(result.errors[0].nodeId, 'task_inferred_kept');
    assert.strictEqual(result.errors[0].message, 'Sanitize Work Station needs a duration.');
    assert.ok(result.errorNodeIds.has('task_inferred_kept'));
  });

  it('6. Legacy node without origin and duration 0 -> error with "needs a duration"', () => {
    // Legacy node saved before origin was added has neither origin on top-level nor in data
    const nodes = [
      {
        id: 'task_legacy',
        type: 'task',
        label: 'Join Ordering Queue',
        data: {
          label: 'Join Ordering Queue',
          duration: 0,
        },
      },
    ];

    const result = validateDurationRules(nodes);
    assert.strictEqual(result.errors.length, 1, 'Legacy node without origin defaults to user and requires duration');
    assert.strictEqual(result.errors[0].nodeId, 'task_legacy');
    assert.strictEqual(result.errors[0].message, 'Join Ordering Queue needs a duration.');
  });

  it('7. Ranges never error: auto-normalize swap and clamping', () => {
    // Reversed min and max
    const reversed = normalizeRanges({ duration: 5, duration_min: 10, duration_max: 2 });
    assert.strictEqual(reversed.duration_min, 2);
    assert.strictEqual(reversed.duration_max, 10);

    // Duration outside min/max range auto-clamps
    const outOfRange = normalizeRanges({ duration: 15, duration_min: 2, duration_max: 10 });
    assert.strictEqual(outOfRange.duration_min, 2);
    assert.strictEqual(outOfRange.duration_max, 15, 'max expanded to cover fixed duration');

    const lowDuration = normalizeRanges({ duration: 1, duration_min: 3, duration_max: 8 });
    assert.strictEqual(lowDuration.duration_min, 1, 'min shrunk to cover fixed duration');
    assert.strictEqual(lowDuration.duration_max, 8);
  });

  it('8. Data model persistence in shapeFrontendToBackend and shapeBackendToFrontend', () => {
    const frontendElements = [
      {
        id: 't_stated',
        type: 'task',
        label: 'Stated Task',
        origin: 'stated',
        data: { label: 'Stated Task', origin: 'stated', duration: 10, estimated: false },
      },
      {
        id: 't_inferred',
        type: 'task',
        label: 'Inferred Task',
        origin: 'inferred',
        kept: true,
        data: { label: 'Inferred Task', origin: 'inferred', kept: true, duration: 5, estimated: true },
      },
      {
        id: 't_legacy',
        type: 'task',
        label: 'Legacy Task',
        data: { label: 'Legacy Task', duration: 3 },
      },
    ];

    const backendShape = shapeFrontendToBackend(frontendElements, [], 'Process Test');
    assert.strictEqual(backendShape.nodes[0].data.origin, 'stated');
    assert.strictEqual(backendShape.nodes[1].data.origin, 'inferred');
    assert.strictEqual(backendShape.nodes[1].data.kept, true);
    assert.strictEqual(backendShape.nodes[1].data.estimated, true);
    assert.strictEqual(backendShape.nodes[2].data.origin, 'user', 'Legacy defaults to user in backend shape');

    const roundtripFrontend = shapeBackendToFrontend(backendShape);
    assert.strictEqual(roundtripFrontend.elements[0].data.origin, 'stated');
    assert.strictEqual(roundtripFrontend.elements[1].data.origin, 'inferred');
    assert.strictEqual(roundtripFrontend.elements[1].data.kept, true);
    assert.strictEqual(roundtripFrontend.elements[1].data.estimated, true);
    assert.strictEqual(roundtripFrontend.elements[2].data.origin, 'user');
  });

});
