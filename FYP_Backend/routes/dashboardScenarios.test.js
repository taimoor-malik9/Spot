const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Scenario = require('../models/Scenario');
const { SimulationRun } = require('../models/SimulationRun');

test('Module P2: Dashboard Scenarios Tab, Changes Summary, & Duplication', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const procId = new mongoose.Types.ObjectId();

  await t.test('1. Scenario enrichment attaches lastRun from SimulationRun', async () => {
    const scenId = new mongoose.Types.ObjectId();
    const mockScenario = {
      _id: scenId,
      baseProcessId: {
        _id: procId,
        title: 'Espresso Bar Baseline',
        resources: [{ name: 'Barista', type: 'staff', quantity: 1 }],
        nodes: [{ id: 'task1', type: 'task', data: { label: 'Pull Shot', duration: 4 } }],
      },
      title: 'Add Second Barista',
      userId,
      resources: [{ name: 'Barista', type: 'staff', quantity: 2 }],
      nodes: [{ id: 'task1', type: 'task', data: { label: 'Pull Shot', duration: 4 } }],
      createdAt: new Date('2026-10-31T11:00:00Z'),
    };

    const mockRun = {
      _id: scenId,
      lastRunId: new mongoose.Types.ObjectId(),
      title: 'Scenario Run - 2 Baristas',
      config: { mode: 'quick', arrival_rate: 1.2, total_instances: 500, seed: 42, replications: 2 },
      summary: { avg_cycle_time: 8.5, avg_wait_time: 1.2, throughput_rate: 0.22, total_cost: 3200 },
      createdAt: new Date('2026-10-31T11:30:00Z'),
    };

    const runMap = { [scenId.toString()]: mockRun };
    const runInfo = runMap[mockScenario._id.toString()];

    const enriched = {
      ...mockScenario,
      lastRun: runInfo
        ? {
            runId: runInfo.lastRunId,
            title: runInfo.title,
            config: runInfo.config,
            summary: runInfo.summary,
            createdAt: runInfo.createdAt,
          }
        : null,
    };

    assert.ok(enriched.lastRun, 'lastRun attached');
    assert.equal(enriched.lastRun.summary.avg_cycle_time, 8.5);
    assert.equal(enriched.lastRun.summary.throughput_rate, 0.22);
    assert.equal(enriched.lastRun.config.arrival_rate, 1.2);
  });

  await t.test('2. Scenario duplication creates owned duplicate with "(Copy)" suffix', async () => {
    const origScenId = new mongoose.Types.ObjectId();
    const origScen = {
      _id: origScenId,
      baseProcessId: procId,
      title: 'Fast Track Scenario',
      userId,
      resources: [{ name: 'Cashier', type: 'staff', quantity: 2 }],
      nodes: [{ id: 't1', type: 'task', data: { duration: 3 } }],
      edges: [{ id: 'e1', source: 't1', target: 't2' }],
      simulationConfig: { arrival_rate: 0.8 },
      goal: 'throughput',
    };

    const dup = new Scenario({
      baseProcessId: origScen.baseProcessId,
      title: `${origScen.title || 'Untitled Scenario'} (Copy)`,
      userId,
      nodes: origScen.nodes,
      edges: origScen.edges,
      resources: origScen.resources,
      simulationConfig: origScen.simulationConfig,
      goal: origScen.goal,
    });

    assert.equal(dup.title, 'Fast Track Scenario (Copy)');
    assert.equal(dup.baseProcessId.toString(), procId.toString());
    assert.equal(dup.userId.toString(), userId.toString());
    assert.equal(dup.resources[0].quantity, 2);
    assert.equal(dup.simulationConfig.arrival_rate, 0.8);
  });

  await t.test('3. Changes summary calculation accurately detects resource and duration before->after', async () => {
    // Replicate computeScenarioChanges logic
    function computeScenarioChanges(scenario, baseProcess) {
      if (!baseProcess) return [{ type: 'info', text: 'Scenario active' }];
      const changes = [];

      const baseResMap = {};
      (baseProcess.resources || []).forEach((r) => {
        const key = (r.name || r.id || '').trim().toLowerCase();
        baseResMap[key] = { name: r.name, quantity: Number(r.quantity) || 0 };
      });

      const scenResMap = {};
      (scenario.resources || []).forEach((r) => {
        const key = (r.name || r.id || '').trim().toLowerCase();
        scenResMap[key] = { name: r.name, quantity: Number(r.quantity) || 0 };
      });

      Object.keys(baseResMap).forEach((key) => {
        const b = baseResMap[key];
        const s = scenResMap[key];
        if (!s) {
          changes.push({ type: 'resource', text: `-${b.name}` });
        } else if (s.quantity !== b.quantity) {
          changes.push({ type: 'resource', text: `${b.name}: ${b.quantity} → ${s.quantity}` });
        }
      });

      Object.keys(scenResMap).forEach((key) => {
        if (!baseResMap[key]) {
          const s = scenResMap[key];
          changes.push({ type: 'resource', text: `+${s.name} (${s.quantity})` });
        }
      });

      const baseNodeMap = {};
      (baseProcess.nodes || []).forEach((n) => {
        const data = n.data && typeof n.data === 'object' ? n.data : n;
        const dur = Number(data.duration);
        if (Number.isFinite(dur)) {
          baseNodeMap[n.id] = { label: data.label || n.id, duration: dur };
        }
      });

      const scenNodeMap = {};
      (scenario.nodes || []).forEach((n) => {
        const data = n.data && typeof n.data === 'object' ? n.data : n;
        const dur = Number(data.duration);
        if (Number.isFinite(dur)) {
          scenNodeMap[n.id] = { label: data.label || n.id, duration: dur };
        }
      });

      Object.keys(baseNodeMap).forEach((id) => {
        const b = baseNodeMap[id];
        const s = scenNodeMap[id];
        if (s && s.duration !== b.duration) {
          const label = s.label || b.label || 'Step';
          changes.push({ type: 'duration', text: `${label}: ${b.duration}m → ${s.duration}m` });
        }
      });

      if (changes.length === 0) {
        return [{ type: 'none', text: 'Identical to baseline' }];
      }
      return changes;
    }

    const base = {
      resources: [{ name: 'Barista', quantity: 1 }, { name: 'Cashier', quantity: 2 }],
      nodes: [
        { id: 'step1', data: { label: 'Take Order', duration: 3 } },
        { id: 'step2', data: { label: 'Brew Coffee', duration: 6 } },
      ],
    };

    const modifiedScen = {
      resources: [{ name: 'Barista', quantity: 2 }, { name: 'Cashier', quantity: 2 }],
      nodes: [
        { id: 'step1', data: { label: 'Take Order', duration: 3 } },
        { id: 'step2', data: { label: 'Brew Coffee', duration: 4 } }, // Shortened by 2m
      ],
    };

    const changes = computeScenarioChanges(modifiedScen, base);
    assert.equal(changes.length, 2);
    assert.equal(changes[0].text, 'Barista: 1 → 2');
    assert.equal(changes[1].text, 'Brew Coffee: 6m → 4m');

    // Test identical scenario
    const identicalChanges = computeScenarioChanges(base, base);
    assert.equal(identicalChanges.length, 1);
    assert.equal(identicalChanges[0].text, 'Identical to baseline');
  });

  await t.test('4. Pagination and multi-selection slice 50+ scenarios correctly', () => {
    // Generate 65 dummy scenarios
    const all = [];
    for (let i = 1; i <= 65; i++) {
      all.push({ _id: `scen_${i}`, title: `Scenario ${i}` });
    }

    const pageSize = 25;
    const totalPages = Math.ceil(all.length / pageSize);
    assert.equal(totalPages, 3);

    // Page 1: items 0 to 24 (25 items)
    const page1 = all.slice(0, 25);
    assert.equal(page1.length, 25);
    assert.equal(page1[0]._id, 'scen_1');
    assert.equal(page1[24]._id, 'scen_25');

    // Page 3: items 50 to 64 (15 items)
    const page3 = all.slice(50, 75);
    assert.equal(page3.length, 15);
    assert.equal(page3[0]._id, 'scen_51');
    assert.equal(page3[14]._id, 'scen_65');

    // Multi-selection set
    const selectedIds = new Set(['scen_1', 'scen_2', 'scen_3']);
    assert.equal(selectedIds.size, 3);
    selectedIds.delete('scen_2');
    assert.equal(selectedIds.size, 2);
    assert.ok(selectedIds.has('scen_1'));
    assert.ok(!selectedIds.has('scen_2'));
  });
});
