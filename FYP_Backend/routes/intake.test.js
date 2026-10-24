// FYP_Backend/routes/intake.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const intakeRoutes = require('./intake');
const aiService = require('../services/aiService');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/intake', intakeRoutes);
  return app;
}

// Simple in-memory HTTP caller using native fetch with an ephemeral server
async function testRequest(app, method, path, body) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { status: res.status, data };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('Module I4: POST /api/intake/parse-answer Express Route Integration Tests', () => {
  const app = createTestApp();
  const sampleDiagram = {
    nodes: [
      { id: 'node_1', type: 'task', label: 'Take Order', origin: 'stated' },
      { id: 'node_2', type: 'task', label: 'Make Coffee', origin: 'stated' },
    ],
    resources: [{ name: 'Barista', type: 'staff' }, { name: 'Cashier', type: 'staff' }],
  };

  it('HTTP 200: Returns fallback: true on missing text, never throws or returns 500', async () => {
    const res = await testRequest(app, 'POST', '/api/intake/parse-answer', {
      screenId: 1,
      text: '',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { fallback: true, text: '' });
  });

  it('HTTP 200: Screen 1 - Parses staff assignment into value shape', async () => {
    const orig = aiService.callGemini;
    try {
      aiService.callGemini = async () => JSON.stringify({
        value: {
          steps: {
            node_1: { staffRoles: ['Cashier'] },
          },
        },
      });

      const res = await testRequest(app, 'POST', '/api/intake/parse-answer', {
        screenId: 1,
        text: 'Cashier handles taking orders',
        rawDiagram: sampleDiagram,
      });

      assert.equal(res.status, 200);
      assert.equal(res.data.fallback, undefined);
      assert.deepEqual(res.data.value, {
        steps: { node_1: { staffRoles: ['Cashier'] } },
      });
      assert.equal(res.data.text, 'Cashier handles taking orders');
    } finally {
      aiService.callGemini = orig;
    }
  });

  it('HTTP 200: Screen 2 - Parses speed into value shape', async () => {
    const orig = aiService.callGemini;
    try {
      aiService.callGemini = async () => JSON.stringify({
        value: {
          steps: {
            node_2: { speed: 'slow' },
          },
        },
      });

      const res = await testRequest(app, 'POST', '/api/intake/parse-answer', {
        screenId: 2,
        text: 'making coffee is slow, takes about 15 minutes',
        rawDiagram: sampleDiagram,
      });

      assert.equal(res.status, 200);
      assert.deepEqual(res.data.value, {
        steps: { node_2: { speed: 'slow' } },
      });
    } finally {
      aiService.callGemini = orig;
    }
  });

  it('HTTP 200: Screen 3 - Parses busyness into value shape', async () => {
    const orig = aiService.callGemini;
    try {
      aiService.callGemini = async () => JSON.stringify({
        value: { busyness: 'packed' },
      });

      const res = await testRequest(app, 'POST', '/api/intake/parse-answer', {
        screenId: 3,
        text: 'we are slammed packed during rush hour',
        rawDiagram: sampleDiagram,
      });

      assert.equal(res.status, 200);
      assert.deepEqual(res.data.value, { busyness: 'packed' });
    } finally {
      aiService.callGemini = orig;
    }
  });

  it('HTTP 200: Screen 4 - Parses disruptions into exceptions array', async () => {
    const orig = aiService.callGemini;
    try {
      aiService.callGemini = async () => JSON.stringify({
        value: { exceptions: ['Out of stock', 'Customer leaves'] },
      });

      const res = await testRequest(app, 'POST', '/api/intake/parse-answer', {
        screenId: 4,
        text: 'sometimes we run out of milk and customers leave',
        rawDiagram: sampleDiagram,
      });

      assert.equal(res.status, 200);
      assert.deepEqual(res.data.value, { exceptions: ['Out of stock', 'Customer leaves'] });
    } finally {
      aiService.callGemini = orig;
    }
  });

  it('HTTP 200: Screen 5 - Parses limited space with count into value shape', async () => {
    const orig = aiService.callGemini;
    try {
      aiService.callGemini = async () => JSON.stringify({
        value: { hasLimitedSpace: true, spaceName: 'Table', spaceUnits: 12 },
      });

      const res = await testRequest(app, 'POST', '/api/intake/parse-answer', {
        screenId: 5,
        text: 'yes we have 12 tables and people wait outside',
        rawDiagram: sampleDiagram,
      });

      assert.equal(res.status, 200);
      assert.deepEqual(res.data.value, {
        hasLimitedSpace: true,
        spaceName: 'Table',
        spaceUnits: 12,
      });
    } finally {
      aiService.callGemini = orig;
    }
  });

  it('HTTP 200: Ambiguous response returns proposal shape instead of guessing', async () => {
    const orig = aiService.callGemini;
    try {
      aiService.callGemini = async () => JSON.stringify({
        proposal: 'You have limited tables. Do you have around 10 tables?',
        proposedValue: { hasLimitedSpace: true, spaceName: 'Table', spaceUnits: 10 },
      });

      const res = await testRequest(app, 'POST', '/api/intake/parse-answer', {
        screenId: 5,
        text: 'tables fill up fast on weekends',
        rawDiagram: sampleDiagram,
      });

      assert.equal(res.status, 200);
      assert.equal(res.data.proposal, 'You have limited tables. Do you have around 10 tables?');
      assert.deepEqual(res.data.proposedValue, {
        hasLimitedSpace: true,
        spaceName: 'Table',
        spaceUnits: 10,
      });
    } finally {
      aiService.callGemini = orig;
    }
  });

  it('HTTP 200: Screen 6 - Parses goal into value shape', async () => {
    const orig = aiService.callGemini;
    try {
      aiService.callGemini = async () => JSON.stringify({
        value: { goal: 'waiting' },
      });

      const res = await testRequest(app, 'POST', '/api/intake/parse-answer', {
        screenId: 6,
        text: 'our biggest problem is customers waiting too long in line',
        rawDiagram: sampleDiagram,
      });

      assert.equal(res.status, 200);
      assert.deepEqual(res.data.value, { goal: 'waiting' });
    } finally {
      aiService.callGemini = orig;
    }
  });

  it('HTTP 200: Screen 7 - Parses costs into value shape', async () => {
    const orig = aiService.callGemini;
    try {
      aiService.callGemini = async () => JSON.stringify({
        value: { costs: { Barista: 45000, Cashier: 40000 } },
      });

      const res = await testRequest(app, 'POST', '/api/intake/parse-answer', {
        screenId: 7,
        text: 'baristas make 45000 a month and cashiers make 40000',
        rawDiagram: sampleDiagram,
      });

      assert.equal(res.status, 200);
      assert.deepEqual(res.data.value, {
        costs: { Barista: 45000, Cashier: 40000 },
      });
    } finally {
      aiService.callGemini = orig;
    }
  });

  it('HTTP 200: On Gemini failure (429, timeout, network error) returns fallback: true and preserves text', async () => {
    const orig = aiService.callGemini;
    try {
      aiService.callGemini = async () => {
        const error = new Error('429 Too Many Requests: Quota exceeded');
        error.status = 429;
        throw error;
      };

      const res = await testRequest(app, 'POST', '/api/intake/parse-answer', {
        screenId: 3,
        text: 'steady crowd every afternoon',
        rawDiagram: sampleDiagram,
      });

      assert.equal(res.status, 200, 'Endpoint MUST return HTTP 200, never 429 or 500');
      assert.equal(res.data.fallback, true);
      assert.equal(res.data.text, 'steady crowd every afternoon');
    } finally {
      aiService.callGemini = orig;
    }
  });
});
