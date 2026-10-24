// FYP_Backend/services/intakeService.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildScreenPrompt, parseIntakeAnswer } = require('./intakeService');
const aiService = require('./aiService');

describe('Module I4: Intake Service Unit Tests', () => {
  const sampleDiagram = {
    nodes: [
      { id: 'start_1', type: 'start-event', label: 'Start' },
      { id: 'task_1', type: 'task', label: 'Take Order', origin: 'stated' },
      { id: 'task_2', type: 'task', label: 'Brew Espresso', origin: 'stated' },
      { id: 'task_inferred', type: 'task', label: 'Clean Bar', origin: 'inferred', kept: false },
      { id: 'end_1', type: 'end-event', label: 'End' },
    ],
    resources: [
      { id: 'r_1', name: 'Barista', type: 'staff' },
      { id: 'r_2', name: 'Cashier', type: 'staff' },
    ],
  };

  describe('buildScreenPrompt', () => {
    it('Screen 1 prompt includes active tasks (excluding unkept inferred) and known staff', () => {
      const prompt = buildScreenPrompt(1, sampleDiagram, {});
      assert.ok(prompt.includes('Take Order'));
      assert.ok(prompt.includes('Brew Espresso'));
      assert.ok(!prompt.includes('Clean Bar'), 'Unkept inferred tasks should be excluded from active tasks context');
      assert.ok(prompt.includes('Barista'));
      assert.ok(prompt.includes('Cashier'));
      assert.ok(prompt.includes('proposal'));
    });

    it('Screen 2 prompt specifies speeds quick/normal/slow and NEVER invent numbers', () => {
      const prompt = buildScreenPrompt(2, sampleDiagram, {});
      assert.ok(prompt.includes('quick'));
      assert.ok(prompt.includes('normal'));
      assert.ok(prompt.includes('slow'));
      assert.ok(prompt.includes('NEVER invent numbers'));
    });

    it('Screen 3 prompt specifies quiet, steady, packed busyness', () => {
      const prompt = buildScreenPrompt(3, sampleDiagram, {});
      assert.ok(prompt.includes('quiet'));
      assert.ok(prompt.includes('steady'));
      assert.ok(prompt.includes('packed'));
    });

    it('Screen 4 prompt specifies disruptions Out of stock, Refund, Customer leaves, Nothing', () => {
      const prompt = buildScreenPrompt(4, sampleDiagram, {});
      assert.ok(prompt.includes('Out of stock'));
      assert.ok(prompt.includes('Refund'));
      assert.ok(prompt.includes('Customer leaves'));
      assert.ok(prompt.includes('Nothing'));
    });

    it('Screen 5 prompt enforces NEVER invent numbers for space', () => {
      const prompt = buildScreenPrompt(5, sampleDiagram, {});
      assert.ok(prompt.includes('hasLimitedSpace'));
      assert.ok(prompt.includes('spaceUnits'));
      assert.ok(prompt.includes('NEVER invent numbers'));
    });

    it('Screen 6 prompt specifies waiting, cost, throughput', () => {
      const prompt = buildScreenPrompt(6, sampleDiagram, {});
      assert.ok(prompt.includes('waiting'));
      assert.ok(prompt.includes('cost'));
      assert.ok(prompt.includes('throughput'));
    });

    it('Screen 7 prompt specifies monthly salaries and existing staff roles', () => {
      const prompt = buildScreenPrompt(7, sampleDiagram, {});
      assert.ok(prompt.includes('costs'));
      assert.ok(prompt.includes('Barista'));
      assert.ok(prompt.includes('NEVER invent numbers'));
    });
  });

  describe('parseIntakeAnswer robustness and fallback guarantees', () => {
    it('returns fallback: true on empty or whitespace input without calling Gemini', async () => {
      const res1 = await parseIntakeAnswer({ screenId: 1, text: '' });
      assert.deepEqual(res1, { fallback: true, text: '' });

      const res2 = await parseIntakeAnswer({ screenId: 2, text: '   ' });
      assert.deepEqual(res2, { fallback: true, text: '   ' });
    });

    it('returns fallback: true and preserves text when Gemini throws an error (e.g. 429 quota)', async () => {
      const origCallGemini = aiService.callGemini;
      try {
        aiService.callGemini = async () => {
          const err = new Error('429 Resource has been exhausted (e.g. check quota)');
          err.status = 429;
          throw err;
        };

        const res = await parseIntakeAnswer({
          screenId: 3,
          text: 'slammed packed',
          rawDiagram: sampleDiagram,
        });

        assert.equal(res.fallback, true);
        assert.equal(res.text, 'slammed packed');
        assert.ok(res.reason.includes('429'));
      } finally {
        aiService.callGemini = origCallGemini;
      }
    });

    it('returns fallback: true and preserves text when Gemini returns non-JSON or malformed output', async () => {
      const origCallGemini = aiService.callGemini;
      try {
        aiService.callGemini = async () => 'Sorry, I cannot help with that query.';

        const res = await parseIntakeAnswer({
          screenId: 4,
          text: 'items run out sometimes',
          rawDiagram: sampleDiagram,
        });

        assert.equal(res.fallback, true);
        assert.equal(res.text, 'items run out sometimes');
      } finally {
        aiService.callGemini = origCallGemini;
      }
    });

    it('returns value shape when clear answer is parsed', async () => {
      const origCallGemini = aiService.callGemini;
      try {
        aiService.callGemini = async () => JSON.stringify({
          value: {
            busyness: 'packed',
          },
        });

        const res = await parseIntakeAnswer({
          screenId: 3,
          text: 'we get totally packed with around 50 people per hour',
          rawDiagram: sampleDiagram,
        });

        assert.ok(!res.fallback);
        assert.equal(res.text, 'we get totally packed with around 50 people per hour');
        assert.deepEqual(res.value, { busyness: 'packed' });
      } finally {
        aiService.callGemini = origCallGemini;
      }
    });

    it('returns proposal shape when ambiguous answer is returned', async () => {
      const origCallGemini = aiService.callGemini;
      try {
        aiService.callGemini = async () => JSON.stringify({
          proposal: 'Did you mean Steady rush (~20 customers/hour)?',
          proposedValue: {
            busyness: 'steady',
          },
        });

        const res = await parseIntakeAnswer({
          screenId: 3,
          text: 'kind of in between quiet and busy',
          rawDiagram: sampleDiagram,
        });

        assert.ok(!res.fallback);
        assert.equal(res.text, 'kind of in between quiet and busy');
        assert.equal(res.proposal, 'Did you mean Steady rush (~20 customers/hour)?');
        assert.deepEqual(res.proposedValue, { busyness: 'steady' });
      } finally {
        aiService.callGemini = origCallGemini;
      }
    });
  });
});
