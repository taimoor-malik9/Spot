const { describe, it } = require('node:test');
const assert = require('node:assert');
const { validateProcessDurations, normalizeRanges } = require('../utils/durationRules');

describe('Module D1b: Backend Duration Rules & Pre-Run Validation', () => {

  it('1. A stated task with no duration -> error', () => {
    const nodes = [
      { id: 't1', type: 'task', label: 'Stated Task', origin: 'stated', data: { duration: 0 } },
    ];
    const res = validateProcessDurations(nodes);
    assert.strictEqual(res.errors.length, 1);
    assert.strictEqual(res.errors[0].nodeId, 't1');
    assert.strictEqual(res.errors[0].message, 'Stated Task needs a duration.');
    assert.ok(res.errorNodeIds.has('t1'));
  });

  it('2. The same task with an intake "Not sure" estimate -> no error, tagged estimated', () => {
    const nodes = [
      { id: 't1', type: 'task', label: 'Estimated Task', origin: 'stated', data: { duration: 5, estimated: true } },
    ];
    const res = validateProcessDurations(nodes);
    assert.strictEqual(res.errors.length, 0);
  });

  it('3. A structural node -> never errors', () => {
    const nodes = [
      { id: 'start', type: 'start-event', origin: 'structural', data: { duration: 0 } },
      { id: 'gw', type: 'exclusive-gateway', origin: 'structural', data: { duration: 0 } },
      { id: 'repair', type: 'task', origin: 'structural', data: { duration: 0 } },
      { id: 'end', type: 'end-event', origin: 'structural', data: { duration: 0 } },
    ];
    const res = validateProcessDurations(nodes);
    assert.strictEqual(res.errors.length, 0);
  });

  it('4. An inferred step -> no duration error but listed as unresolved', () => {
    const nodes = [
      { id: 't_inf', type: 'task', label: 'Inferred Step', origin: 'inferred', kept: false, data: { duration: 0 } },
    ];
    const res = validateProcessDurations(nodes);
    assert.strictEqual(res.errors.length, 0);
    assert.strictEqual(res.unresolvedInferred.length, 1);
    assert.strictEqual(res.unresolvedInferred[0].nodeId, 't_inf');
    assert.strictEqual(res.unresolvedInferred[0].message, 'AI suggested this step: Keep or Remove');
  });

  it('5. Keep then empty duration -> error', () => {
    const nodes = [
      { id: 't_inf', type: 'task', label: 'Inferred Kept Step', origin: 'inferred', kept: true, data: { duration: 0 } },
    ];
    const res = validateProcessDurations(nodes);
    assert.strictEqual(res.errors.length, 1);
    assert.strictEqual(res.errors[0].nodeId, 't_inf');
    assert.strictEqual(res.errors[0].message, 'Inferred Kept Step needs a duration.');
  });

  it('6. Legacy node without origin and duration 0 -> error with "needs a duration"', () => {
    const nodes = [
      { id: 't_leg', type: 'task', label: 'Legacy Task', data: { duration: 0 } },
    ];
    const res = validateProcessDurations(nodes);
    assert.strictEqual(res.errors.length, 1);
    assert.strictEqual(res.errors[0].nodeId, 't_leg');
    assert.strictEqual(res.errors[0].message, 'Legacy Task needs a duration.');
  });

  it('7. Ranges auto-normalize: min/max swapped and clamped', () => {
    const norm1 = normalizeRanges({ duration: 5, duration_min: 10, duration_max: 2 });
    assert.strictEqual(norm1.duration_min, 2);
    assert.strictEqual(norm1.duration_max, 10);

    const norm2 = normalizeRanges({ duration: 12, duration_min: 3, duration_max: 8 });
    assert.strictEqual(norm2.duration_max, 12);
  });

});
