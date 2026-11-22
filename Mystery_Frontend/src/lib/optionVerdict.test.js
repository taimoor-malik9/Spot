import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildVerdict, fmtMin, fmtRs, pctChange } from './optionVerdict.js';

describe('option card helpers', () => {
  it('formats minutes, money and percent change', () => {
    assert.equal(fmtMin(5.25), '5.3 min');
    assert.equal(fmtMin(125), '2h 5m');
    assert.equal(fmtMin(null), '—');
    assert.equal(fmtRs(233.678), 'Rs 234');
    assert.equal(fmtRs(8.16), 'Rs 8.2');
    assert.equal(pctChange(100, 150), 50);
    assert.equal(pctChange(0, 5), null);
    assert.equal(pctChange(null, 5), null);
  });

  it('says "costs more, no real improvement" for an added courier that changes nothing', () => {
    const v = buildVerdict({ row: { change: -1 }, goalMetric: 'waiting', cpcPct: 47, cpcAbs: 75 });
    assert.deepEqual(v, { text: 'Costs more, no real improvement', tone: 'bad' });
  });

  it('flags a real improvement that also costs more', () => {
    const v = buildVerdict({ row: { change: -30 }, goalMetric: 'waiting', cpcPct: 20, cpcAbs: 40 });
    assert.equal(v.tone, 'warn');
    assert.match(v.text, /costs Rs 40 more per customer/);
  });

  it('treats throughput increases as good and cost goal decreases as good', () => {
    assert.equal(buildVerdict({ row: { change: 12 }, goalMetric: 'throughput', cpcPct: 0, cpcAbs: 0 }).tone, 'good');
    assert.equal(buildVerdict({ row: { change: -12 }, goalMetric: 'cost', cpcPct: -12, cpcAbs: -9 }).text, 'Better, and cheaper');
  });

  it('reports no real change inside the 5% band and labels the baseline', () => {
    assert.equal(buildVerdict({ row: { change: -3 }, goalMetric: 'waiting', cpcPct: 2, cpcAbs: 1 }).text, 'No real change');
    assert.equal(buildVerdict({ row: { baseline: true }, goalMetric: 'waiting' }).text, 'Where you are today');
  });
});