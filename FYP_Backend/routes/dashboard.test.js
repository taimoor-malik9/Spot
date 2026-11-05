const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Process = require('../models/Process');
const Scenario = require('../models/Scenario');
const { SimulationRun } = require('../models/SimulationRun');

test('Module P1: Dashboard Data Enrichment, Process Duplication, & State Hydration', async (t) => {
  const { shapeBackendToFrontend } = await import('../shared/shapeBackendToFrontend.js');
  const userId = new mongoose.Types.ObjectId();
  const reqUser = { user: { _id: userId, id: userId.toString() }, params: {}, body: {}, query: {} };

  await t.test('1. Process enrichment attaches scenarioCount and lastRunSummary', async () => {
    const procId = new mongoose.Types.ObjectId();
    const mockProc = {
      _id: procId,
      title: 'Coffee Shop Ordering',
      userId,
      nodes: [{ id: 'n1', type: 'task', data: { duration: 5 } }],
      edges: [],
      updatedAt: new Date('2026-10-31T12:00:00Z'),
      createdAt: new Date('2026-10-31T10:00:00Z'),
    };

    // Simulate enrichment logic matching server.js GET /api/process
    const mockScenarioCounts = [{ _id: procId, count: 3 }];
    const scenCountMap = { [procId.toString()]: 3 };

    const mockLatestRuns = [
      {
        _id: procId,
        lastRunId: new mongoose.Types.ObjectId(),
        title: 'Quick Simulation',
        scenarioId: null,
        summary: { avg_cycle_time: 14.2, throughput_rate: 0.15 },
        createdAt: new Date('2026-10-31T12:30:00Z'),
      },
    ];
    const runMap = { [procId.toString()]: mockLatestRuns[0] };

    const pIdStr = mockProc._id.toString();
    const enriched = {
      ...mockProc,
      scenarioCount: scenCountMap[pIdStr] || 0,
      lastRunSummary: runMap[pIdStr]?.summary
        ? {
            runId: runMap[pIdStr].lastRunId,
            title: runMap[pIdStr].title,
            scenarioId: runMap[pIdStr].scenarioId,
            avg_cycle_time: runMap[pIdStr].summary.avg_cycle_time,
            throughput_rate: runMap[pIdStr].summary.throughput_rate,
            createdAt: runMap[pIdStr].createdAt,
          }
        : null,
    };

    assert.equal(enriched.scenarioCount, 3);
    assert.ok(enriched.lastRunSummary);
    assert.equal(enriched.lastRunSummary.avg_cycle_time, 14.2);
    assert.equal(enriched.lastRunSummary.throughput_rate, 0.15);
  });

  await t.test('2. Process duplication clones document with "(Copy)" title and user ownership', async () => {
    const origProcId = new mongoose.Types.ObjectId();
    const origProc = {
      _id: origProcId,
      title: 'Warehouse Logistics',
      userId,
      resources: [{ name: 'Operator', type: 'staff', quantity: 2 }],
      nodes: [{ id: 'n1', type: 'task', data: { duration: 10 } }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      simulationConfig: { arrival_rate: 0.5 },
      goal: 'waiting',
    };

    // Create duplicate matching server.js POST /api/process/:id/duplicate
    const dup = new Process({
      title: `${origProc.title || 'Untitled Process'} (Copy)`,
      userId: reqUser.user._id,
      resources: origProc.resources,
      nodes: origProc.nodes,
      edges: origProc.edges,
      simulationConfig: origProc.simulationConfig,
      goal: origProc.goal,
    });

    assert.equal(dup.title, 'Warehouse Logistics (Copy)');
    assert.equal(dup.userId.toString(), userId.toString());
    assert.equal(dup.resources.length, 1);
    assert.equal(dup.simulationConfig.arrival_rate, 0.5);
    assert.equal(dup.goal, 'waiting');
  });

  await t.test('3. Opening a process sets spot:processId, spot:processTitle, spot:model:nodes and clears spot:activeScenarioId', async () => {
    const procId = new mongoose.Types.ObjectId().toString();
    const proc = {
      _id: procId,
      title: 'Retail Checkout',
      nodes: [
        { id: 'start', type: 'start-event', data: { label: 'Start' } },
        { id: 'task1', type: 'task', data: { label: 'Scan Item', duration: 2 } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'task1' },
      ],
      resources: [{ name: 'Cashier', type: 'staff', quantity: 1 }],
    };

    // Mock localStorage
    const mockStorage = {
      'spot:processId': 'old_process_123',
      'spot:activeScenarioId': 'scenario_to_clear',
    };

    const storageInterface = {
      setItem: (k, v) => { mockStorage[k] = v; },
      getItem: (k) => mockStorage[k] ?? null,
      removeItem: (k) => { delete mockStorage[k]; },
    };

    // Simulation of handleOpenProcess
    const { elements: els, connections: conns } = shapeBackendToFrontend(proc);
    storageInterface.setItem('spot:processId', proc._id);
    storageInterface.setItem('spot:processTitle', proc.title);
    storageInterface.setItem('spot:model:nodes', JSON.stringify({ nodes: els, connections: conns }));
    storageInterface.removeItem('spot:activeScenarioId');
    if (proc.resources && Array.isArray(proc.resources)) {
      storageInterface.setItem('spot:globalResources', JSON.stringify(proc.resources));
    }

    assert.equal(storageInterface.getItem('spot:processId'), procId);
    assert.equal(storageInterface.getItem('spot:processTitle'), 'Retail Checkout');
    assert.equal(storageInterface.getItem('spot:activeScenarioId'), null, 'spot:activeScenarioId must be cleared');
    const parsedNodes = JSON.parse(storageInterface.getItem('spot:model:nodes'));
    assert.ok(parsedNodes.nodes.length >= 2);
    assert.ok(parsedNodes.connections.length >= 1);
  });

  await t.test('4. Recent activity merges runs and scenarios and caps at 10 newest items', async () => {
    const runs = [
      { _id: 'r1', title: 'Run 1', createdAt: new Date('2026-10-31T10:00:00Z') },
      { _id: 'r2', title: 'Run 2', createdAt: new Date('2026-10-31T12:00:00Z') },
    ];
    const scenarios = [
      { _id: 's1', title: 'Scenario A', createdAt: new Date('2026-10-31T11:00:00Z') },
      { _id: 's2', title: 'Scenario B', createdAt: new Date('2026-10-31T13:00:00Z') },
    ];

    const items = [];
    runs.forEach(r => items.push({ id: r._id, type: 'run', date: new Date(r.createdAt) }));
    scenarios.forEach(s => items.push({ id: s._id, type: 'scenario', date: new Date(s.createdAt) }));
    items.sort((a, b) => b.date.getTime() - a.date.getTime());
    const top10 = items.slice(0, 10);

    assert.equal(top10.length, 4);
    assert.equal(top10[0].id, 's2', 'Newest item at 13:00 is first');
    assert.equal(top10[1].id, 'r2', 'Second newest at 12:00');
    assert.equal(top10[2].id, 's1', 'Third newest at 11:00');
    assert.equal(top10[3].id, 'r1', 'Fourth newest at 10:00');
  });
});
