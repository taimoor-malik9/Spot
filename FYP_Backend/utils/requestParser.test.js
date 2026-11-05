// FYP_Backend/utils/requestParser.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const resultsAiService = require('../services/resultsAiService');
const { parseRequestWithRegex, parseImprovementRequest } = require('./requestParser');

describe('Request Parser & Gemini String Output Parsing', () => {
  it('parseRequestWithRegex handles percentages, fractions, and directions', () => {
    const r1 = parseRequestWithRegex('cut cycle time by 40%');
    assert.deepStrictEqual(r1, { metric: 'cycle_time', direction: 'decrease', target_pct: 40 });

    const r2 = parseRequestWithRegex('cut waiting in half');
    assert.deepStrictEqual(r2, { metric: 'waiting', direction: 'decrease', target_pct: 50 });

    const r3 = parseRequestWithRegex('double throughput');
    assert.deepStrictEqual(r3, { metric: 'throughput', direction: 'increase', target_pct: 100 });

    const r4 = parseRequestWithRegex('make it cheaper');
    assert.deepStrictEqual(r4, { metric: 'cost', direction: 'decrease', target_pct: null });
  });

  it('parseImprovementRequest parses fenced JSON string from callGemini', async () => {
    const origCall = resultsAiService.callGemini;
    resultsAiService.callGemini = async () => {
      return '```json\n{\n  "metric": "cycle_time",\n  "direction": "decrease",\n  "target_pct": 35\n}\n```';
    };

    try {
      const res = await parseImprovementRequest('how do I streamline operations');
      assert.strictEqual(res.metric, 'cycle_time');
      assert.strictEqual(res.direction, 'decrease');
      assert.strictEqual(res.target_pct, 35);
    } finally {
      resultsAiService.callGemini = origCall;
    }
  });

  it('parseImprovementRequest parses plain JSON string without fences', async () => {
    const origCall = resultsAiService.callGemini;
    resultsAiService.callGemini = async () => {
      return '{"metric": "cost", "direction": "decrease", "target_pct": 15}';
    };

    try {
      const res = await parseImprovementRequest('lower expenditures');
      assert.strictEqual(res.metric, 'cost');
      assert.strictEqual(res.direction, 'decrease');
      assert.strictEqual(res.target_pct, 15);
    } finally {
      resultsAiService.callGemini = origCall;
    }
  });

  it('parseImprovementRequest falls back safely when Gemini returns malformed string', async () => {
    const origCall = resultsAiService.callGemini;
    resultsAiService.callGemini = async () => {
      return 'I cannot parse this into JSON';
    };

    try {
      const res = await parseImprovementRequest('unknown request', 'throughput');
      assert.strictEqual(res.metric, 'throughput');
      assert.strictEqual(res.direction, 'decrease');
      assert.strictEqual(res.target_pct, null);
    } finally {
      resultsAiService.callGemini = origCall;
    }
  });
});
