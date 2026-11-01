const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRequestWithRegex, parseImprovementRequest } = require('../utils/requestParser');

test('Module G1: Request Parsing & Summary Rules', async (t) => {
  await t.test('1. parseRequestWithRegex extracts metric, direction, and target_pct', () => {
    // 50% waiting
    const r1 = parseRequestWithRegex('reduce waiting by 50%');
    assert.deepEqual(r1, { metric: 'waiting', direction: 'decrease', target_pct: 50 });

    // 50% cycle time
    const r2 = parseRequestWithRegex('reduce cycle time by 50%');
    assert.deepEqual(r2, { metric: 'cycle_time', direction: 'decrease', target_pct: 50 });

    // cut waiting in half
    const r3 = parseRequestWithRegex('cut waiting in half');
    assert.deepEqual(r3, { metric: 'waiting', direction: 'decrease', target_pct: 50 });

    // make process twice as fast
    const r4 = parseRequestWithRegex('make the process twice as fast');
    assert.deepEqual(r4, { metric: 'cycle_time', direction: 'decrease', target_pct: 50 });

    // No target: returns target_pct: null (never default silently to 20%)
    const r5 = parseRequestWithRegex('how can I reduce waiting?');
    assert.deepEqual(r5, { metric: 'waiting', direction: 'decrease', target_pct: null });

    // Throughput increase
    const r6 = parseRequestWithRegex('increase throughput by 30%');
    assert.deepEqual(r6, { metric: 'throughput', direction: 'increase', target_pct: 30 });
  });

  await t.test('2. parseImprovementRequest resolves valid payload without default 20%', async () => {
    const res = await parseImprovementRequest('speed up the process by 40%');
    assert.equal(res.metric, 'cycle_time');
    assert.equal(res.target_pct, 40);
  });
});
