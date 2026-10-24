// FYP_Backend/routes/solveProblem.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const router = require('./ai');
const Process = require('../models/Process');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', router);
  return app;
}

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

describe('Module I5: POST /api/ai/solve-problem simulationConfig & goal integration', () => {
  const app = createTestApp();

  it('Reads arrival_rate and goal from processDoc.simulationConfig when config is omitted', async () => {
    const origFindById = Process.findById;
    const origFetch = global.fetch;

    let capturedEngineBody = null;

    try {
      // Mock Process.findById to return a process with saved simulationConfig & goal
      Process.findById = async (id) => ({
        _id: id,
        title: 'Coffee Process',
        nodes: [{ id: 't1', type: 'task', data: { duration: 5 } }],
        edges: [],
        resources: [{ name: 'Barista', type: 'staff', quantity: 1 }],
        simulationConfig: {
          arrival_rate: 0.75, // 45 per hour
          busyness: 'packed',
          goal: 'throughput',
        },
        goal: 'throughput',
      });

      // Mock engine fetch call
      global.fetch = async (url, options) => {
        if (url.includes('/experiment')) {
          capturedEngineBody = JSON.parse(options.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              baseline: { avg_wait_time: 2.5, total_cost: 45000 },
              variants: [],
              best: null,
              variant_definitions: [],
            }),
          };
        }
        return origFetch(url, options);
      };

      const res = await testRequest(app, 'POST', '/api/ai/solve-problem', {
        processId: 'proc_123',
        message: 'How can we improve throughput?',
        // Note: config is omitted!
      });

      assert.equal(res.status, 200);
      assert.ok(capturedEngineBody, 'Simulation engine /experiment endpoint was called');
      assert.equal(capturedEngineBody.config.arrival_rate, 0.75, 'arrival_rate read from processDoc.simulationConfig');
      assert.equal(capturedEngineBody.goal, 'throughput', 'goal read from processDoc.simulationConfig');
    } finally {
      Process.findById = origFindById;
      global.fetch = origFetch;
    }
  });

  it('Reads goal from config when passed explicitly ("cost")', async () => {
    const origFindById = Process.findById;
    const origFetch = global.fetch;

    let capturedEngineBody = null;

    try {
      Process.findById = async (id) => ({
        _id: id,
        title: 'Retail Process',
        nodes: [{ id: 't1', type: 'task', data: { duration: 5 } }],
        edges: [],
        resources: [],
        simulationConfig: { arrival_rate: 0.33, goal: 'waiting' },
      });

      global.fetch = async (url, options) => {
        if (url.includes('/experiment')) {
          capturedEngineBody = JSON.parse(options.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              baseline: { avg_wait_time: 4, total_cost: 60000 },
              variants: [],
              best: null,
              variant_definitions: [],
            }),
          };
        }
        return origFetch(url, options);
      };

      const res = await testRequest(app, 'POST', '/api/ai/solve-problem', {
        processId: 'proc_123',
        message: 'Optimize our process',
        config: { arrival_rate: 0.33, goal: 'cost' },
      });

      assert.equal(res.status, 200);
      assert.equal(capturedEngineBody.goal, 'cost', 'explicit config.goal "cost" passed to engine');
    } finally {
      Process.findById = origFindById;
      global.fetch = origFetch;
    }
  });
});
