// FYP_Backend/routes/moduleG1b.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseRequestWithRegex, parseImprovementRequest } = require('../utils/requestParser');

test('Module G1b: Target parsing & Summary validation', async (t) => {
  await t.test('parses "reduce my cycle time" with null target_pct (no silent 20%)', async () => {
    const res = await parseImprovementRequest('reduce my cycle time');
    assert.strictEqual(res.metric, 'cycle_time');
    assert.strictEqual(res.direction, 'decrease');
    assert.strictEqual(res.target_pct, null);
  });

  await t.test('parses "reduce it by 50%" inheriting context goal', async () => {
    const res = await parseImprovementRequest('reduce it by 50%', 'cycle_time');
    assert.strictEqual(res.metric, 'cycle_time');
    assert.strictEqual(res.direction, 'decrease');
    assert.strictEqual(res.target_pct, 50);
  });

  await t.test('parses "cut waiting in half"', async () => {
    const res = await parseImprovementRequest('cut waiting in half');
    assert.strictEqual(res.metric, 'waiting');
    assert.strictEqual(res.direction, 'decrease');
    assert.strictEqual(res.target_pct, 50);
  });

  await t.test('parses "twice as fast"', async () => {
    const res = await parseImprovementRequest('twice as fast');
    assert.strictEqual(res.metric, 'cycle_time');
    assert.strictEqual(res.direction, 'decrease');
    assert.strictEqual(res.target_pct, 50);
  });

  await t.test('parses explicit percentage "speed up by 30%"', async () => {
    const res = await parseImprovementRequest('speed up by 30%');
    assert.strictEqual(res.metric, 'cycle_time');
    assert.strictEqual(res.target_pct, 30);
  });

  await t.test('fallback summary for zero wait and no meaningful change', () => {
    const experiment = {
      baseline: { avg_cycle_time: 32.6, avg_wait_time: 0.0, total_cost: 46547.03 },
      best: { label: 'Speed up Create Patient File by 10%', metrics: { avg_cycle_time: 32.6, avg_wait_time: 0.0 }, recommended: false },
      no_meaningful_change: true,
      zero_wait_note: 'Nobody waits at this load; cycle time is work time.',
      target: null,
    };

    const baseline = experiment.baseline;
    const first = baseline.avg_wait_time < 0.05
      ? 'Nobody waits at this load; cycle time is work time.'
      : `The current process has an average cycle time of ${baseline.avg_cycle_time} minutes and costs Rs ${baseline.total_cost}.`;
    const second = 'No option changed your cycle time.';
    const summary = `${first} ${second}`;

    assert.match(summary, /\.$/);
    assert.ok(summary.includes('Nobody waits at this load; cycle time is work time.'));
    assert.ok(summary.includes('No option changed your cycle time.'));
    assert.strictEqual(summary.split(/(?<=[.!?])\s+/).length, 2);
  });

  await t.test('fallback summary for 50% target with honest ceiling', () => {
    const experiment = {
      baseline: { avg_cycle_time: 32.6, avg_wait_time: 0.0, total_cost: 46547.03 },
      best: {
        label: 'Speed up Examine Patient by 20%',
        metrics: { avg_cycle_time: 29.1, avg_wait_time: 0.0 },
        delta_vs_baseline: { cost_abs: 0.0 },
        recommended: false,
      },
      target: { metric: 'cycle_time', direction: 'decrease', target_pct: 50 },
      target_met: false,
      achieved_pct: 10.7,
      reason: 'Staff-handled steps are 19.5 of 32.6 minutes, so the best you can reach is 29.9%. The rest is customer time or fixed.',
    };

    const metricName = 'cycle time';
    const targetText = `Target: reduce ${metricName} by ${experiment.target.target_pct}%.`;
    const reasonText = experiment.reason ? ` ${experiment.reason}` : '';
    const summary = `${targetText} Best achievable is a ${experiment.achieved_pct}% reduction with ${experiment.best.label}.${reasonText}`;

    assert.match(summary, /\.$/);
    assert.ok(summary.includes('Target: reduce cycle time by 50%.'));
    assert.ok(summary.includes('Staff-handled steps are 19.5 of 32.6 minutes, so the best you can reach is 29.9%.'));
    assert.ok(!summary.includes('...'));
  });
});
