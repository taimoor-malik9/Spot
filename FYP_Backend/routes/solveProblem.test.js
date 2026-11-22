// FYP_Backend/routes/solveProblem.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const router = require('./ai');
const Process = require('../models/Process');

const mongoose = require('mongoose');

function createTestApp(testUserId) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { _id: testUserId, id: testUserId.toString() };
    next();
  });
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
  const testUserId = new mongoose.Types.ObjectId();
  const testProcId = new mongoose.Types.ObjectId();
  const app = createTestApp(testUserId);

  it('Uses the confirmed arrival_rate and reads goal from processDoc.simulationConfig', async () => {
    const origFindById = Process.findById;
    const origFindOne = Process.findOne;
    const origFetch = global.fetch;

    let capturedEngineBody = null;

    try {
      const mockDoc = {
        _id: testProcId,
        userId: testUserId,
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
      };
      // Mock Process.findById and Process.findOne to return a process with saved simulationConfig & goal
      Process.findById = async (id) => mockDoc;
      Process.findOne = async () => mockDoc;

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
        processId: testProcId.toString(),
        message: 'How can we improve throughput?',
        config: { arrival_rate: 0.75, arrival_confirmed: true },
      });

      assert.equal(res.status, 200);
      assert.ok(capturedEngineBody, 'Simulation engine /experiment endpoint was called');
      assert.equal(capturedEngineBody.config.arrival_rate, 0.75, 'confirmed arrival_rate is sent to the engine');
      assert.equal(capturedEngineBody.goal, 'throughput', 'goal read from processDoc.simulationConfig');
    } finally {
      Process.findById = origFindById;
      Process.findOne = origFindOne;
      global.fetch = origFetch;
    }
  });

  it('Reads goal from config when passed explicitly ("cost")', async () => {
    const origFindById = Process.findById;
    const origFindOne = Process.findOne;
    const origFetch = global.fetch;

    let capturedEngineBody = null;

    try {
      const mockDoc = {
        _id: testProcId,
        userId: testUserId,
        title: 'Retail Process',
        nodes: [{ id: 't1', type: 'task', data: { duration: 5 } }],
        edges: [],
        resources: [],
        simulationConfig: { arrival_rate: 0.33, goal: 'waiting' },
      };
      Process.findById = async (id) => mockDoc;
      Process.findOne = async () => mockDoc;

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
        processId: testProcId.toString(),
        message: 'Optimize our process',
        config: { arrival_rate: 0.33, arrival_confirmed: true, goal: 'cost' },
      });

      assert.equal(res.status, 200);
      assert.equal(capturedEngineBody.goal, 'cost', 'explicit config.goal "cost" passed to engine');
    } finally {
      Process.findById = origFindById;
      Process.findOne = origFindOne;
      global.fetch = origFetch;
    }
  });
});

describe('solve-problem asks for the arrival rate', () => {
  const testUserId = new mongoose.Types.ObjectId();
  const testProcId = new mongoose.Types.ObjectId();
  const app = createTestApp(testUserId);

  it('asks (with the saved value as a suggestion) until the user confirms, and never runs the engine', async () => {
    const origFindById = Process.findById;
    const origFindOne = Process.findOne;
    const origFetch = global.fetch;
    let engineCalled = false;
    try {
      const mockDoc = {
        _id: testProcId, userId: testUserId, title: 'Clinic',
        nodes: [{ id: 't1', type: 'task', data: { duration: 5 } }], edges: [], resources: [],
        simulationConfig: { arrival_rate: 0.25 },
      };
      Process.findById = async () => mockDoc;
      Process.findOne = async () => mockDoc;
      global.fetch = async (url, options) => {
        if (String(url).includes('/experiment')) engineCalled = true;
        return origFetch(url, options);
      };
      const res = await testRequest(app, 'POST', '/api/ai/solve-problem', {
        processId: testProcId.toString(),
        message: 'How can I reduce waiting?',
        config: { arrival_rate: 0.25 },
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.type, 'question');
      assert.equal(res.data.suggested_minutes, 4);
      assert.equal(engineCalled, false);
    } finally {
      Process.findById = origFindById;
      Process.findOne = origFindOne;
      global.fetch = origFetch;
    }
  });

  it('returns the assumptions it used once the arrival rate is confirmed', async () => {
    const origFindById = Process.findById;
    const origFindOne = Process.findOne;
    const origFetch = global.fetch;
    try {
      const mockDoc = {
        _id: testProcId, userId: testUserId, title: 'Clinic',
        nodes: [{ id: 't1', type: 'task', data: { duration: 5 } }], edges: [], resources: [],
        simulationConfig: {},
      };
      Process.findById = async () => mockDoc;
      Process.findOne = async () => mockDoc;
      global.fetch = async (url, options) => {
        if (String(url).includes('/experiment')) {
          return { ok: true, status: 200, json: async () => ({
            baseline: { avg_wait_time: 2, total_cost: 1000, cost_per_customer: 8, hours_simulated: 36 },
            variants: [], best: null, variant_definitions: [],
          }) };
        }
        return origFetch(url, options);
      };
      const res = await testRequest(app, 'POST', '/api/ai/solve-problem', {
        processId: testProcId.toString(),
        message: 'How can I reduce waiting?',
        config: { arrival_rate: 0.2, arrival_confirmed: true },
      });
      assert.equal(res.data.type, 'evidence');
      assert.equal(res.data.assumptions.interval_minutes, 5);
      assert.equal(res.data.assumptions.customers_simulated, 120);
      assert.equal(res.data.assumptions.hours_simulated, 36);
    } finally {
      Process.findById = origFindById;
      Process.findOne = origFindOne;
      global.fetch = origFetch;
    }
  });
});